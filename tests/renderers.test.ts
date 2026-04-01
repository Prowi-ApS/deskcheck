/**
 * Tests for the terminal and markdown renderers with the new Issue model.
 */
import { describe, it, expect } from "vitest";
import { renderTerminal } from "../src/renderers/review/TerminalRenderer.js";
import { renderMarkdown } from "../src/renderers/review/MarkdownRenderer.js";
import { renderJson } from "../src/renderers/review/JsonRenderer.js";
import { groupIssuesBySeveritySection } from "../src/renderers/shared.js";
import type { ReviewResults, ReviewPlan } from "../src/types/review.js";

function makeResults(overrides: Partial<ReviewResults> = {}): ReviewResults {
  return {
    plan_id: "2026-03-31_120000",
    status: "complete",
    updated_at: "2026-03-31T12:00:00Z",
    completion: { total: 2, completed: 2, pending: 0, in_progress: 0, errored: 0 },
    summary: { total: 2, critical: 1, warning: 1, info: 0 },
    task_results: {
      "arch--dto-001": {
        task_id: "arch--dto-001",
        review_id: "arch/dto",
        files: ["src/service.ts"],
        completed_at: "2026-03-31T12:00:00Z",
        issues: [
          {
            severity: "critical",
            description: "SQL injection in query builder",
            suggestion: "Use parameterized queries",
            references: [{
              file: "src/service.ts",
              symbol: "Service::query",
              line: 42,
              code: "db.raw(`SELECT * FROM ${table}`)",
              suggestedCode: "db.select('*').from(table)",
              note: null,
            }],
          },
          {
            severity: "warning",
            description: "Duplicated client setup across handlers",
            suggestion: "Extract shared client",
            references: [
              { file: "src/service.ts", symbol: "Service::init", line: 5, code: "new HttpClient()", suggestedCode: null, note: "First" },
              { file: "src/handler.ts", symbol: "Handler::init", line: 8, code: "new HttpClient()", suggestedCode: null, note: "Duplicated" },
            ],
          },
        ],
        usage: null,
      },
    },
    by_file: {},
    by_module: {},
    total_usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: 0.05,
      duration_ms: 5000,
      duration_api_ms: 4000,
      num_turns: 3,
    },
    ...overrides,
  };
}

function makePlan(): ReviewPlan {
  return {
    plan_id: "2026-03-31_120000",
    name: "feature/order-rework vs develop",
    source: { type: "diff", target: "develop" },
    status: "complete",
    created_at: "2026-03-31T12:00:00Z",
    finalized_at: "2026-03-31T12:00:00Z",
    started_at: "2026-03-31T12:00:00Z",
    completed_at: "2026-03-31T12:00:00Z",
    matched_files: ["src/service.ts", "src/handler.ts"],
    unmatched_files: ["README.md"],
    tasks: {},
    modules: {},
  };
}

describe("groupIssuesBySeveritySection", () => {
  it("groups issues by severity and filters empty sections", () => {
    const results = makeResults();
    const sections = groupIssuesBySeveritySection(results);

    expect(sections).toHaveLength(2); // critical + warning, no info
    expect(sections[0]!.severity).toBe("critical");
    expect(sections[0]!.label).toBe("Critical Issues");
    expect(sections[0]!.issues).toHaveLength(1);
    expect(sections[1]!.severity).toBe("warning");
    expect(sections[1]!.issues).toHaveLength(1);
  });

  it("returns empty array for results with no issues", () => {
    const results = makeResults({
      summary: { total: 0, critical: 0, warning: 0, info: 0 },
      task_results: {},
    });
    const sections = groupIssuesBySeveritySection(results);
    expect(sections).toHaveLength(0);
  });
});

describe("renderTerminal", () => {
  it("includes issue descriptions", () => {
    const output = renderTerminal(makeResults(), makePlan());
    expect(output).toContain("SQL injection in query builder");
    expect(output).toContain("Duplicated client setup across handlers");
  });

  it("includes symbol references", () => {
    const output = renderTerminal(makeResults(), makePlan());
    expect(output).toContain("Service::query");
  });

  it("includes code snippets", () => {
    const output = renderTerminal(makeResults(), makePlan());
    expect(output).toContain("db.raw(`SELECT * FROM ${table}`)");
  });

  it("includes suggested code", () => {
    const output = renderTerminal(makeResults(), makePlan());
    expect(output).toContain("suggested:");
    expect(output).toContain("db.select('*').from(table)");
  });

  it("includes suggestions", () => {
    const output = renderTerminal(makeResults(), makePlan());
    expect(output).toContain("Use parameterized queries");
  });

  it("includes reference notes", () => {
    const output = renderTerminal(makeResults(), makePlan());
    expect(output).toContain("First");
    expect(output).toContain("Duplicated");
  });

  it("shows coverage", () => {
    const output = renderTerminal(makeResults(), makePlan());
    expect(output).toContain("2 files reviewed");
    expect(output).toContain("1 not covered");
  });

  it("shows no findings message for clean results", () => {
    const results = makeResults({
      summary: { total: 0, critical: 0, warning: 0, info: 0 },
      task_results: {},
    });
    const output = renderTerminal(results, makePlan());
    expect(output).toContain("No findings");
  });
});

describe("renderMarkdown", () => {
  it("includes issue descriptions", () => {
    const output = renderMarkdown(makeResults(), makePlan());
    expect(output).toContain("SQL injection in query builder");
  });

  it("includes reference locations with symbols", () => {
    const output = renderMarkdown(makeResults(), makePlan());
    expect(output).toContain("Service::query");
  });

  it("includes code blocks", () => {
    const output = renderMarkdown(makeResults(), makePlan());
    expect(output).toContain("db.raw(`SELECT * FROM ${table}`)");
  });

  it("includes suggested code blocks", () => {
    const output = renderMarkdown(makeResults(), makePlan());
    expect(output).toContain("**Suggested:**");
    expect(output).toContain("db.select('*').from(table)");
  });

  it("shows issue count header", () => {
    const output = renderMarkdown(makeResults(), makePlan());
    expect(output).toContain("**2 issues**");
  });

  it("includes reference notes", () => {
    const output = renderMarkdown(makeResults(), makePlan());
    expect(output).toContain("First");
    expect(output).toContain("Duplicated");
  });
});

describe("renderJson", () => {
  it("serializes results as JSON", () => {
    const results = makeResults();
    const output = renderJson(results);
    const parsed = JSON.parse(output);
    expect(parsed.summary.total).toBe(2);
    expect(parsed.task_results["arch--dto-001"].issues).toHaveLength(2);
  });
});
