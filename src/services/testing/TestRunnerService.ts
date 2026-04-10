import fs from "node:fs";
import path from "node:path";
import type { ReviewConfig } from "../../config/types.js";
import type { TestCase, TestCaseResult, TestRun } from "../../types/testing.js";
import type { ReviewTask } from "../../types/review.js";
import { ExecutorService } from "../ExecutorService.js";
import { buildExecutorPrompt } from "../../prompts/ExecutorPrompt.js";
import { parseFindings } from "../FindingsParserService.js";
import { parseCriterion } from "../criteria/CriteriaService.js";
import { TestStorageService } from "./TestStorageService.js";
import { JudgeService } from "./JudgeService.js";
import { calculateScores } from "./TestScorerService.js";

// =============================================================================
// Types
// =============================================================================

/** Step within a single test case's execution. */
export type TestStep = "executing" | "judging";

/** Options for controlling test run behavior. */
export interface TestRunOptions {
  /** Max concurrent test cases. Defaults to 5. */
  concurrency?: number;
  /** Called when a test case moves to a new step (executing, judging). */
  onTestStep?: (criterionId: string, testName: string, step: TestStep) => void;
  /** Called after each test case completes (or errors), for live progress reporting. */
  onTestComplete?: (criterionId: string, testName: string, result: TestCaseResult) => void;
}

// =============================================================================
// TestRunnerService
// =============================================================================

/**
 * Orchestrates the full test pipeline: executor -> judge -> scorer -> storage.
 *
 * Runs test cases sequentially (no concurrency). For each test case:
 * 1. Execute the criterion against the fixture file
 * 2. Judge the findings against expected results
 * 3. Score the judge's verdicts
 * 4. Persist everything to storage
 */
export class TestRunnerService {
  private readonly config: ReviewConfig;
  private readonly projectRoot: string;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  /**
   * Run all test cases and return the completed test run.
   *
   * Uses a concurrency pool (default 5) so multiple test cases execute in
   * parallel. Tests within the same criterion share the Agent SDK prompt
   * cache, so they benefit from running close together in time.
   *
   * @param testCases - Discovered test cases to execute.
   * @param storageDir - Directory where test run results are persisted.
   * @param options - Optional callbacks for progress reporting.
   * @returns The final TestRun with all results.
   */
  async run(
    testCases: TestCase[],
    storageDir: string,
    options?: TestRunOptions,
  ): Promise<TestRun> {
    const storage = new TestStorageService(storageDir);
    const executorService = new ExecutorService(this.config, this.projectRoot);
    const judgeService = new JudgeService(this.config, this.projectRoot);
    const maxConcurrent = options?.concurrency ?? 5;

    // Initialize the run with all tests as "pending"
    const run = storage.createRun(testCases);
    const runId = run.run_id;

    // Track which suites have been started
    const startedSuites = new Set<string>();

    /** Run a single test case end-to-end and notify callbacks. */
    const runOne = async (testCase: TestCase): Promise<void> => {
      // Mark suite as running if not yet started
      if (!startedSuites.has(testCase.criterionId)) {
        storage.updateSuiteStatus(runId, testCase.criterionId, "running");
        startedSuites.add(testCase.criterionId);
      }

      try {
        await this.executeTestCase(
          testCase,
          runId,
          storage,
          executorService,
          judgeService,
          options,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        storage.updateTestCase(runId, testCase.criterionId, testCase.name, {
          status: "error",
          error: errorMessage,
        });
      }

      // Notify caller of test completion
      if (options?.onTestComplete) {
        const currentRun = storage.getRun(runId);
        const result = currentRun.suites[testCase.criterionId]?.tests[testCase.name];
        if (result) {
          options.onTestComplete(testCase.criterionId, testCase.name, result);
        }
      }
    };

    // Concurrency pool
    const pool: Promise<void>[] = [];
    let idx = 0;

    // Fill initial batch
    while (idx < testCases.length && pool.length < maxConcurrent) {
      const tc = testCases[idx]!;
      idx++;
      const p = runOne(tc).then(() => { pool.splice(pool.indexOf(p), 1); });
      pool.push(p);
    }

    // As slots free up, start more
    while (pool.length > 0) {
      await Promise.race(pool);
      while (idx < testCases.length && pool.length < maxConcurrent) {
        const tc = testCases[idx]!;
        idx++;
        const p = runOne(tc).then(() => { pool.splice(pool.indexOf(p), 1); });
        pool.push(p);
      }
    }

    // Update suite statuses to "complete"
    for (const criterionId of startedSuites) {
      storage.updateSuiteStatus(runId, criterionId, "complete");
    }

    // Complete the run
    storage.completeRun(runId);

    return storage.getRun(runId);
  }

  /**
   * Execute a single test case through the full pipeline.
   */
  private async executeTestCase(
    testCase: TestCase,
    runId: string,
    storage: TestStorageService,
    executorService: ExecutorService,
    judgeService: JudgeService,
    options?: TestRunOptions,
  ): Promise<void> {
    // Step 1: Update status to "executing"
    storage.updateTestCase(runId, testCase.criterionId, testCase.name, {
      status: "executing",
    });
    options?.onTestStep?.(testCase.criterionId, testCase.name, "executing");

    // Step 2: Parse the criterion
    // criterionFile is relative to the parent of the criteria dir (e.g. "criteria/backend/controller-conventions.md")
    // The criteria dir config value is e.g. "deskcheck/criteria", so the parent is "deskcheck/"
    // parseCriterion needs the absolute file path and the absolute criteria dir as base
    const criteriaDir = path.resolve(this.projectRoot, this.config.modules_dir);
    const absoluteCriterionFile = path.resolve(path.dirname(criteriaDir), testCase.criterionFile);
    const criterion = parseCriterion(absoluteCriterionFile, criteriaDir);

    // Step 3: Build a synthetic ReviewTask for the executor. The reviewer
    // will Read the fixture file itself via its built-in tools.
    const task: ReviewTask = {
      task_id: `test-${testCase.criterionId}-${testCase.name}`,
      review_id: testCase.criterionId,
      review_file: testCase.criterionFile,
      files: [testCase.fixtureFile],
      scope: { type: "all" },
      focus: null,
      hint: null,
      model: criterion.model,
      tools: criterion.tools,
      error: null,
      status: "pending",
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      prompt: criterion.prompt,
    };

    // Step 5: Build executor prompt and execute
    const prompt = buildExecutorPrompt(task);
    const executorResult = await executorService.execute(prompt, criterion.model, {
      effort: criterion.effort,
    });

    // Step 6: Parse findings
    const findings = parseFindings(executorResult.resultText);

    // Step 7: Update storage with findings and executor usage, move to "judging"
    storage.updateTestCase(runId, testCase.criterionId, testCase.name, {
      status: "judging",
      findings,
      executor_usage: executorResult.usage,
    });
    options?.onTestStep?.(testCase.criterionId, testCase.name, "judging");

    // Step 8: Read expected.md
    const expectedContent = fs.readFileSync(testCase.expectedFile, "utf-8");

    // Step 9: Judge findings against expectations. The judge needs the
    // fixture content for context, so we read it here.
    const fixtureContent = fs.readFileSync(testCase.fixtureFile, "utf-8");
    const judgeOutput = await judgeService.evaluate(
      criterion,
      expectedContent,
      findings,
      fixtureContent,
    );

    // Step 10: Score the judge's verdicts
    const scores = calculateScores(judgeOutput.result);

    // Step 11: Update storage with judge result, scores, and judge usage
    storage.updateTestCase(runId, testCase.criterionId, testCase.name, {
      status: "complete",
      judge: judgeOutput.result,
      scores,
      judge_usage: judgeOutput.usage,
    });
  }
}
