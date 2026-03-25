import fs from "node:fs";
import path from "node:path";
import type {
  TestCase,
  TestCaseResult,
  TestRun,
  TestSuiteStatus,
} from "../../types/testing.js";

// =============================================================================
// Helpers
// =============================================================================

/** Format a Date as YYYY-MM-DD_HHmmss for use as a run ID / directory name. */
function formatTimestamp(date: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

// =============================================================================
// TestStorageService
// =============================================================================

/**
 * Persists test runs to .deskcheck/test-runs/ using atomic writes.
 *
 * Each test run lives in a timestamped directory containing a single
 * results.json file. Uses write-to-tmp + rename for atomic updates.
 * No file locking needed since test runs execute sequentially.
 */
export class TestStorageService {
  private readonly storageDir: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
  }

  /**
   * Create a new test run with all test cases initialized as "pending".
   *
   * Creates a timestamped directory and writes an initial results.json.
   */
  createRun(testCases: TestCase[]): TestRun {
    const now = new Date();
    const runId = formatTimestamp(now);
    const runDir = path.join(this.storageDir, runId);

    fs.mkdirSync(runDir, { recursive: true });

    // Group test cases by criterionId to build suites
    const suites: TestRun["suites"] = {};

    for (const testCase of testCases) {
      if (!suites[testCase.criterionId]) {
        suites[testCase.criterionId] = {
          status: "pending",
          criterion_file: testCase.criterionFile,
          tests: {},
        };
      }

      const initialResult: TestCaseResult = {
        status: "pending",
        fixture_file: testCase.fixtureFile,
        expected_file: testCase.expectedFile,
        findings: null,
        judge: null,
        scores: null,
        error: null,
        executor_usage: null,
        judge_usage: null,
      };

      suites[testCase.criterionId].tests[testCase.name] = initialResult;
    }

    const run: TestRun = {
      run_id: runId,
      status: "running",
      started_at: now.toISOString(),
      completed_at: null,
      suites,
    };

    this.writeRun(runId, run);
    return run;
  }

  /** Read the results.json for a given run ID. */
  getRun(runId: string): TestRun {
    const resultsPath = this.resultsPath(runId);
    const raw = fs.readFileSync(resultsPath, "utf-8");
    return JSON.parse(raw) as TestRun;
  }

  /**
   * Return the most recent run directory name, or null if no runs exist.
   */
  getLatestRunId(): string | null {
    if (!fs.existsSync(this.storageDir)) {
      return null;
    }

    const entries = fs.readdirSync(this.storageDir, { withFileTypes: true });
    const runDirs = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(this.storageDir, entry.name, "results.json")),
      )
      .map((entry) => entry.name)
      .sort();

    if (runDirs.length === 0) {
      return null;
    }

    return runDirs[runDirs.length - 1];
  }

  /**
   * Update a specific test case in results.json.
   *
   * Reads the current run, applies the partial update to the specified
   * test case, and writes back atomically.
   */
  updateTestCase(
    runId: string,
    criterionId: string,
    testName: string,
    update: Partial<TestCaseResult>,
  ): void {
    const run = this.getRun(runId);
    const suite = run.suites[criterionId];

    if (!suite) {
      throw new Error(`Suite "${criterionId}" not found in run "${runId}"`);
    }

    const testCase = suite.tests[testName];
    if (!testCase) {
      throw new Error(`Test "${testName}" not found in suite "${criterionId}" of run "${runId}"`);
    }

    Object.assign(testCase, update);
    this.writeRun(runId, run);
  }

  /** Update a suite's status. */
  updateSuiteStatus(runId: string, criterionId: string, status: TestSuiteStatus): void {
    const run = this.getRun(runId);
    const suite = run.suites[criterionId];

    if (!suite) {
      throw new Error(`Suite "${criterionId}" not found in run "${runId}"`);
    }

    suite.status = status;
    this.writeRun(runId, run);
  }

  /** Mark the run as complete with a completion timestamp. */
  completeRun(runId: string): void {
    const run = this.getRun(runId);
    run.status = "complete";
    run.completed_at = new Date().toISOString();
    this.writeRun(runId, run);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private resultsPath(runId: string): string {
    return path.join(this.storageDir, runId, "results.json");
  }

  /** Atomic write: write to .tmp then rename. */
  private writeRun(runId: string, run: TestRun): void {
    const target = this.resultsPath(runId);
    const tmp = target + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + "\n");
    fs.renameSync(tmp, target);
  }
}
