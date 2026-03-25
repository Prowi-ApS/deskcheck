import type { Finding, TaskUsage } from "./review.js";

// =============================================================================
// Status Types
// =============================================================================

/** Status of an individual test case. */
export type TestCaseStatus = "pending" | "executing" | "judging" | "complete" | "error";

/** Status of a test suite (all tests for one criterion). */
export type TestSuiteStatus = "pending" | "running" | "complete";

/** Status of the overall test run. */
export type TestRunStatus = "running" | "complete";

// =============================================================================
// Test Discovery
// =============================================================================

/** A discovered test case mapping a fixture file to expected results. */
export interface TestCase {
  /** Criterion identifier, e.g. "backend/controller-conventions". */
  criterionId: string;
  /** Test case name (subdirectory name), e.g. "missing-return-types". */
  name: string;
  /** Path to the criterion .md file. */
  criterionFile: string;
  /** Path to the fixture file (code to be reviewed). */
  fixtureFile: string;
  /** Path to expected.md describing what should/shouldn't be found. */
  expectedFile: string;
}

// =============================================================================
// Judge Output
// =============================================================================

/** Judge's annotation of a single executor finding. */
export interface FindingReview {
  /** The finding description from the executor. */
  finding: string;
  /** Whether the finding is correct, out of scope, or has wrong severity. */
  verdict: "correct" | "out_of_scope" | "incorrect_severity";
  /** Which check from the criterion this finding relates to, e.g. "#3 - Missing type hints". */
  criterion_check: string | null;
  /** Brief explanation of the verdict. */
  comment: string;
}

/** Judge's annotation of a single expectation from expected.md. */
export interface ExpectationReview {
  /** The expectation text from expected.md. */
  expectation: string;
  /** Whether a finding matched this expectation. */
  verdict: "found" | "missed";
  /** Which finding matched, if any. */
  matched_finding: string | null;
  /** Brief explanation of the verdict. */
  comment: string;
}

/** Complete judge output for a test case. */
export interface JudgeResult {
  /** Review of each finding the executor produced. */
  findings_review: FindingReview[];
  /** Review of each expectation from expected.md. */
  expectations_review: ExpectationReview[];
}

// =============================================================================
// Scores (derived from judge verdicts)
// =============================================================================

/** Derived scores computed from judge verdicts. Pure math, no LLM involved. */
export interface TestScores {
  total_findings: number;
  correct: number;
  out_of_scope: number;
  incorrect_severity: number;
  total_expectations: number;
  expectations_found: number;
  expectations_missed: number;
  /** expectations_found / total_expectations (1.0 if no expectations). */
  recall: number;
  /** correct / total_findings (1.0 if no findings). */
  precision: number;
  /** (total_findings - out_of_scope) / total_findings (1.0 if no findings). */
  scope_compliance: number;
}

// =============================================================================
// Test Case Result (persisted in JSON)
// =============================================================================

/** Result of a single test case, persisted in the test run JSON. */
export interface TestCaseResult {
  /** Current lifecycle status. */
  status: TestCaseStatus;
  /** Path to the fixture file that was reviewed. */
  fixture_file: string;
  /** Path to the expected.md file. */
  expected_file: string;
  /** Findings produced by the executor agent. */
  findings: Finding[] | null;
  /** Judge's evaluation of findings vs expectations. */
  judge: JudgeResult | null;
  /** Derived scores from judge verdicts. */
  scores: TestScores | null;
  /** Error message if the test case failed. */
  error: string | null;
  /** Token usage from the executor agent run. */
  executor_usage: TaskUsage | null;
  /** Token usage from the judge agent run. */
  judge_usage: TaskUsage | null;
}

// =============================================================================
// Test Suite & Test Run (persisted to disk)
// =============================================================================

/** A test suite groups all test cases for one criterion. */
export interface TestSuite {
  /** Current lifecycle status. */
  status: TestSuiteStatus;
  /** Path to the criterion .md file. */
  criterion_file: string;
  /** Test case results keyed by test name. */
  tests: Record<string, TestCaseResult>;
}

/** The complete test run persisted to disk as results.json. */
export interface TestRun {
  /** Unique run identifier (timestamped directory name). */
  run_id: string;
  /** Current lifecycle status. */
  status: TestRunStatus;
  /** ISO 8601 timestamp when the run started. */
  started_at: string;
  /** ISO 8601 timestamp when the run completed, or null if still running. */
  completed_at: string | null;
  /** Test suites keyed by criterionId. */
  suites: Record<string, TestSuite>;
}
