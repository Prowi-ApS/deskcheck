/**
 * Tests for storage lifecycle transitions added in stage 7:
 * - errorTask persisting task.error
 * - setStep auto-promoting status on terminal steps
 * - setFailure stamping failure details
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReviewStorageService } from "../src/services/review/ReviewStorageService.js";

let tmpDir: string;
let storage: ReviewStorageService;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskcheck-lifecycle-"));
  storage = new ReviewStorageService(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createPlanWithOneTask(): { planId: string; taskId: string } {
  const plan = storage.createPlan("test", { type: "all" }, {
    command: "deskcheck",
    args: ["test"],
    cwd: "/tmp",
  });

  storage.setModules(plan.plan_id, {
    "test/crit": {
      review_id: "test/crit",
      description: "test criterion",
      model: "haiku",
      partition: "one task per file",
      task_count: 0,
      matched_files: ["a.ts"],
    },
  });

  storage.addTask(plan.plan_id, {
    review_id: "test/crit",
    review_file: "criteria/test.md",
    files: ["a.ts"],
    hint: null,
    model: "haiku",
  });

  storage.finalizePlan(plan.plan_id);

  const tasks = Object.keys(storage.getPlan(plan.plan_id).tasks);
  return { planId: plan.plan_id, taskId: tasks[0]! };
}

// =============================================================================
// errorTask — persists task.error
// =============================================================================

describe("errorTask", () => {
  it("persists the error message on the task", () => {
    const { planId, taskId } = createPlanWithOneTask();
    storage.claimTask(planId, taskId);
    storage.errorTask(planId, taskId, "Agent timed out after 5 minutes");

    const plan = storage.getPlan(planId);
    const task = plan.tasks[taskId]!;
    expect(task.status).toBe("error");
    expect(task.error).toBe("Agent timed out after 5 minutes");
  });

  it("sets error to null on successful tasks", () => {
    const { planId, taskId } = createPlanWithOneTask();
    storage.claimTask(planId, taskId);
    storage.completeTask(planId, taskId, []);

    const task = storage.getPlan(planId).tasks[taskId]!;
    expect(task.error).toBeNull();
  });

  it("records usage even when the task errors", () => {
    const { planId, taskId } = createPlanWithOneTask();
    storage.claimTask(planId, taskId);
    storage.errorTask(planId, taskId, "crash", {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: 0.001,
      duration_ms: 5000,
      duration_api_ms: 4000,
      num_turns: 2,
      model: "haiku",
    });

    const results = storage.getResults(planId);
    const taskResult = results.task_results[taskId];
    expect(taskResult).toBeDefined();
    expect(taskResult!.usage!.input_tokens).toBe(100);
  });
});

// =============================================================================
// setStep — auto-promotes status on terminal steps
// =============================================================================

describe("setStep", () => {
  it("updates step without promoting status for non-terminal steps", () => {
    const plan = storage.createPlan("test", { type: "all" }, {
      command: "deskcheck", args: [], cwd: "/tmp",
    });

    storage.setStep(plan.plan_id, "partitioning");
    const updated = storage.getPlan(plan.plan_id);
    expect(updated.step).toBe("partitioning");
    expect(updated.status).toBe("planning"); // not promoted
  });

  it("auto-promotes status to complete when step transitions to complete", () => {
    const plan = storage.createPlan("test", { type: "all" }, {
      command: "deskcheck", args: [], cwd: "/tmp",
    });

    storage.setStep(plan.plan_id, "complete");
    const updated = storage.getPlan(plan.plan_id);
    expect(updated.step).toBe("complete");
    expect(updated.status).toBe("complete");
    expect(updated.completed_at).not.toBeNull();
  });

  it("auto-promotes status to failed when step transitions to failed", () => {
    const plan = storage.createPlan("test", { type: "all" }, {
      command: "deskcheck", args: [], cwd: "/tmp",
    });

    storage.setStep(plan.plan_id, "failed");
    const updated = storage.getPlan(plan.plan_id);
    expect(updated.step).toBe("failed");
    expect(updated.status).toBe("failed");
    expect(updated.completed_at).not.toBeNull();
  });

  it("does not overwrite completed_at if already set", () => {
    const plan = storage.createPlan("test", { type: "all" }, {
      command: "deskcheck", args: [], cwd: "/tmp",
    });

    // Manually set completed_at via a complete task flow, then re-set step
    storage.setStep(plan.plan_id, "complete");
    const first = storage.getPlan(plan.plan_id).completed_at;

    // Re-setting to complete shouldn't change the timestamp
    storage.setStep(plan.plan_id, "complete");
    const second = storage.getPlan(plan.plan_id).completed_at;
    expect(second).toBe(first);
  });
});

// =============================================================================
// setFailure — stamps failure details on the plan
// =============================================================================

describe("setFailure", () => {
  it("marks the plan as failed with the failure blob", () => {
    const plan = storage.createPlan("test", { type: "all" }, {
      command: "deskcheck", args: [], cwd: "/tmp",
    });

    storage.setFailure(plan.plan_id, {
      step: "partitioning",
      review_id: "security/sql-injection",
      message: "Partitioner agent timed out",
    });

    const updated = storage.getPlan(plan.plan_id);
    expect(updated.status).toBe("failed");
    expect(updated.step).toBe("failed");
    expect(updated.failure).not.toBeNull();
    expect(updated.failure!.step).toBe("partitioning");
    expect(updated.failure!.review_id).toBe("security/sql-injection");
    expect(updated.failure!.message).toBe("Partitioner agent timed out");
    expect(updated.completed_at).not.toBeNull();
  });

  it("overwrites a previous failure (idempotent)", () => {
    const plan = storage.createPlan("test", { type: "all" }, {
      command: "deskcheck", args: [], cwd: "/tmp",
    });

    storage.setFailure(plan.plan_id, {
      step: "partitioning",
      review_id: "first",
      message: "first error",
    });

    storage.setFailure(plan.plan_id, {
      step: "reviewing",
      review_id: null,
      message: "second error",
    });

    const updated = storage.getPlan(plan.plan_id);
    expect(updated.failure!.message).toBe("second error");
    expect(updated.failure!.step).toBe("reviewing");
    expect(updated.failure!.review_id).toBeNull();
  });

  it("stamps failure with null review_id for run-wide errors", () => {
    const plan = storage.createPlan("test", { type: "all" }, {
      command: "deskcheck", args: [], cwd: "/tmp",
    });

    storage.setFailure(plan.plan_id, {
      step: "reviewing",
      review_id: null,
      message: "Orchestrator crashed",
    });

    const updated = storage.getPlan(plan.plan_id);
    expect(updated.failure!.review_id).toBeNull();
  });
});

// =============================================================================
// parseIssues endLine defaulting
// =============================================================================

import { parseIssues } from "../src/services/FindingsParserService.js";

describe("parseIssues endLine defaulting", () => {
  it("defaults endLine to startLine when only startLine is provided", () => {
    const input = JSON.stringify([{
      severity: "warning",
      description: "test",
      references: [{ file: "a.ts", startLine: 42 }],
    }]);

    const issues = parseIssues(input);
    expect(issues[0]!.references[0]!.startLine).toBe(42);
    expect(issues[0]!.references[0]!.endLine).toBe(42);
  });

  it("preserves explicit endLine when provided", () => {
    const input = JSON.stringify([{
      severity: "warning",
      description: "test",
      references: [{ file: "a.ts", startLine: 10, endLine: 20 }],
    }]);

    const issues = parseIssues(input);
    expect(issues[0]!.references[0]!.startLine).toBe(10);
    expect(issues[0]!.references[0]!.endLine).toBe(20);
  });

  it("defaults contextLines to 3 when not provided", () => {
    const input = JSON.stringify([{
      severity: "info",
      description: "test",
      references: [{ file: "a.ts", startLine: 5 }],
    }]);

    const issues = parseIssues(input);
    expect(issues[0]!.references[0]!.contextLines).toBe(3);
  });

  it("respects explicit contextLines", () => {
    const input = JSON.stringify([{
      severity: "info",
      description: "test",
      references: [{ file: "a.ts", startLine: 5, contextLines: 10 }],
    }]);

    const issues = parseIssues(input);
    expect(issues[0]!.references[0]!.contextLines).toBe(10);
  });

  it("always sets code to null (populated later by CodeSnippetService)", () => {
    const input = JSON.stringify([{
      severity: "info",
      description: "test",
      references: [{ file: "a.ts", startLine: 1, code: "should be stripped" }],
    }]);

    const issues = parseIssues(input);
    expect(issues[0]!.references[0]!.code).toBeNull();
  });
});
