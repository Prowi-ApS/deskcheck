/**
 * Tests for the aggregation logic in ReviewStorage.
 *
 * Uses a real ReviewStorage instance with a temp directory to test
 * completeTask and the resulting by_file / by_module / summary.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReviewStorage } from "../src/core/storage.js";
import type { Issue, ReviewResults } from "../src/core/types.js";

let tmpDir: string;
let storage: ReviewStorage;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskcheck-test-"));
  storage = new ReviewStorage(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createTestPlan(): string {
  const plan = storage.createPlan("test-plan", { type: "file", target: "main" });

  // Set up modules
  storage.setModules(plan.plan_id, {
    "arch/dto": {
      review_id: "arch/dto",
      description: "DTO enforcement",
      severity: "high",
      model: "sonnet",
      task_count: 0,
      matched_files: ["src/service.ts", "src/handler.ts"],
    },
  });

  // Add tasks
  storage.addTask(plan.plan_id, {
    review_id: "arch/dto",
    review_file: "criteria/arch/dto.md",
    files: ["src/service.ts"],
    hint: null,
    model: "sonnet",
  });

  storage.addTask(plan.plan_id, {
    review_id: "arch/dto",
    review_file: "criteria/arch/dto.md",
    files: ["src/handler.ts"],
    hint: null,
    model: "sonnet",
  });

  // Finalize
  storage.finalizePlan(plan.plan_id);

  // Claim tasks
  const finalized = storage.getPlan(plan.plan_id);
  for (const task of Object.values(finalized.tasks)) {
    storage.claimTask(plan.plan_id, task.task_id, {
      contextType: "file",
      content: "file content here",
      prompt: "review this",
    });
  }

  return plan.plan_id;
}

describe("aggregation with Issue model", () => {
  it("aggregates a single-reference issue correctly", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    const issues: Issue[] = [{
      severity: "warning",
      description: "Missing return type",
      suggestion: "Add return type annotation",
      references: [{
        file: "src/service.ts",
        symbol: "Service::getData",
        line: 15,
        code: "getData() {",
        suggestedCode: "getData(): Data {",
        note: null,
      }],
    }];

    storage.completeTask(planId, taskIds[0]!, issues);

    const results = storage.getResults(planId);
    expect(results.summary.total).toBe(1);
    expect(results.summary.warning).toBe(1);

    // by_file should have the issue under src/service.ts
    expect(results.by_file["src/service.ts"]).toHaveLength(1);
    const fileIssue = results.by_file["src/service.ts"]![0]!;
    expect(fileIssue.description).toBe("Missing return type");
    expect(fileIssue.review_id).toBe("arch/dto");
    expect(fileIssue.issue_id).toBe(`${taskIds[0]}:0`);
    expect(fileIssue.references[0]!.symbol).toBe("Service::getData");
    expect(fileIssue.references[0]!.code).toBe("getData() {");
    expect(fileIssue.references[0]!.suggestedCode).toBe("getData(): Data {");
  });

  it("indexes cross-file issue under all referenced files", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    const crossFileIssue: Issue[] = [{
      severity: "warning",
      description: "Duplicated HTTP client setup",
      suggestion: "Extract shared client",
      references: [
        { file: "src/service.ts", symbol: "Service::init", line: 5, code: "new HttpClient()", suggestedCode: null, note: "First occurrence" },
        { file: "src/handler.ts", symbol: "Handler::init", line: 8, code: "new HttpClient()", suggestedCode: null, note: "Duplicated" },
      ],
    }];

    storage.completeTask(planId, taskIds[0]!, crossFileIssue);

    const results = storage.getResults(planId);
    expect(results.summary.total).toBe(1); // One issue, not two

    // Issue appears under BOTH files
    expect(results.by_file["src/service.ts"]).toHaveLength(1);
    expect(results.by_file["src/handler.ts"]).toHaveLength(1);

    // Same issue_id under both files
    expect(results.by_file["src/service.ts"]![0]!.issue_id).toBe(`${taskIds[0]}:0`);
    expect(results.by_file["src/handler.ts"]![0]!.issue_id).toBe(`${taskIds[0]}:0`);
  });

  it("does not double-count a cross-file issue in summary", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    const issues: Issue[] = [{
      severity: "critical",
      description: "Security issue spanning files",
      suggestion: null,
      references: [
        { file: "src/service.ts", symbol: null, line: 1, code: null, suggestedCode: null, note: null },
        { file: "src/handler.ts", symbol: null, line: 1, code: null, suggestedCode: null, note: null },
        { file: "src/other.ts", symbol: null, line: 1, code: null, suggestedCode: null, note: null },
      ],
    }];

    storage.completeTask(planId, taskIds[0]!, issues);

    const results = storage.getResults(planId);
    // Summary counts issues, not references
    expect(results.summary.total).toBe(1);
    expect(results.summary.critical).toBe(1);
  });

  it("aggregates by_module correctly", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    storage.completeTask(planId, taskIds[0]!, [{
      severity: "warning",
      description: "Issue 1",
      suggestion: null,
      references: [{ file: "src/service.ts", symbol: null, line: null, code: null, suggestedCode: null, note: null }],
    }]);

    storage.completeTask(planId, taskIds[1]!, [{
      severity: "critical",
      description: "Issue 2",
      suggestion: null,
      references: [{ file: "src/handler.ts", symbol: null, line: null, code: null, suggestedCode: null, note: null }],
    }]);

    const results = storage.getResults(planId);
    const moduleIssues = results.by_module["arch/dto"]!;
    expect(moduleIssues.completed).toBe(2);
    expect(moduleIssues.counts.total).toBe(2);
    expect(moduleIssues.counts.warning).toBe(1);
    expect(moduleIssues.counts.critical).toBe(1);
    expect(moduleIssues.issues).toHaveLength(2);
  });

  it("handles empty issues array", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    storage.completeTask(planId, taskIds[0]!, []);

    const results = storage.getResults(planId);
    expect(results.summary.total).toBe(0);
    expect(Object.keys(results.by_file)).toHaveLength(0);
  });

  it("deduplicates by_file entries when multiple references point to same file", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    const issues: Issue[] = [{
      severity: "info",
      description: "Multiple issues in same file",
      suggestion: null,
      references: [
        { file: "src/service.ts", symbol: "Foo::a", line: 10, code: null, suggestedCode: null, note: null },
        { file: "src/service.ts", symbol: "Foo::b", line: 20, code: null, suggestedCode: null, note: null },
      ],
    }];

    storage.completeTask(planId, taskIds[0]!, issues);

    const results = storage.getResults(planId);
    // Issue should appear only ONCE under the file, not twice
    expect(results.by_file["src/service.ts"]).toHaveLength(1);
  });

  it("sets status to complete when all tasks finish", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    storage.completeTask(planId, taskIds[0]!, []);
    let results = storage.getResults(planId);
    expect(results.status).toBe("partial");

    storage.completeTask(planId, taskIds[1]!, []);
    results = storage.getResults(planId);
    expect(results.status).toBe("complete");
  });

  it("stamps issue_id as task_id:index", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    storage.completeTask(planId, taskIds[0]!, [
      { severity: "warning", description: "Issue A", suggestion: null, references: [{ file: "src/service.ts", symbol: null, line: null, code: null, suggestedCode: null, note: null }] },
      { severity: "critical", description: "Issue B", suggestion: null, references: [{ file: "src/service.ts", symbol: null, line: null, code: null, suggestedCode: null, note: null }] },
      { severity: "info", description: "Issue C", suggestion: null, references: [{ file: "src/service.ts", symbol: null, line: null, code: null, suggestedCode: null, note: null }] },
    ]);

    const results = storage.getResults(planId);
    const taskResult = results.task_results[taskIds[0]!]!;
    expect(taskResult.issues[0]!.issue_id).toBe(`${taskIds[0]}:0`);
    expect(taskResult.issues[1]!.issue_id).toBe(`${taskIds[0]}:1`);
    expect(taskResult.issues[2]!.issue_id).toBe(`${taskIds[0]}:2`);
  });

  it("issue_id is stable across recomputation", () => {
    const planId = createTestPlan();
    const plan = storage.getPlan(planId);
    const taskIds = Object.keys(plan.tasks);

    storage.completeTask(planId, taskIds[0]!, [
      { severity: "warning", description: "Issue A", suggestion: null, references: [{ file: "src/service.ts", symbol: null, line: null, code: null, suggestedCode: null, note: null }] },
    ]);

    const results1 = storage.getResults(planId);
    const id1 = results1.task_results[taskIds[0]!]!.issues[0]!.issue_id;

    // Complete second task — triggers full recomputation
    storage.completeTask(planId, taskIds[1]!, []);

    const results2 = storage.getResults(planId);
    const id2 = results2.task_results[taskIds[0]!]!.issues[0]!.issue_id;

    expect(id1).toBe(id2);
  });
});
