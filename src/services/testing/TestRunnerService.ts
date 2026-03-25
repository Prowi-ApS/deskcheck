import fs from "node:fs";
import type { ReviewConfig } from "../../config/types.js";
import type { TestCase, TestRun } from "../../types/testing.js";
import type { ReviewTask } from "../../types/review.js";
import { ExecutorService } from "../ExecutorService.js";
import { buildExecutorPrompt } from "../../prompts/ExecutorPrompt.js";
import { parseFindings } from "../FindingsParserService.js";
import { parseCriterion } from "../criteria/CriteriaService.js";
import { TestStorageService } from "./TestStorageService.js";
import { JudgeService } from "./JudgeService.js";
import { calculateScores } from "./TestScorerService.js";

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
   * @param testCases - Discovered test cases to execute.
   * @param storageDir - Directory where test run results are persisted.
   * @returns The final TestRun with all results.
   */
  async run(
    testCases: TestCase[],
    storageDir: string,
  ): Promise<TestRun> {
    const storage = new TestStorageService(storageDir);
    const executorService = new ExecutorService(this.config, this.projectRoot);
    const judgeService = new JudgeService(this.config, this.projectRoot);

    // Initialize the run with all tests as "pending"
    const run = storage.createRun(testCases);
    const runId = run.run_id;

    // Track which suites have been started
    const startedSuites = new Set<string>();

    for (const testCase of testCases) {
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
        );
      } catch (error) {
        // Catch unexpected errors and record them
        const errorMessage = error instanceof Error ? error.message : String(error);
        storage.updateTestCase(runId, testCase.criterionId, testCase.name, {
          status: "error",
          error: errorMessage,
        });
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
  ): Promise<void> {
    // Step 1: Update status to "executing"
    storage.updateTestCase(runId, testCase.criterionId, testCase.name, {
      status: "executing",
    });

    // Step 2: Read the fixture file
    const fixtureContent = fs.readFileSync(testCase.fixtureFile, "utf-8");

    // Step 3: Parse the criterion
    const criterionDir = testCase.criterionFile.split("/").slice(0, -1).join("/");
    const criterion = parseCriterion(testCase.criterionFile, criterionDir || ".");

    // Step 4: Build a synthetic ReviewTask for the executor
    const task: ReviewTask = {
      task_id: `test-${testCase.criterionId}-${testCase.name}`,
      review_id: testCase.criterionId,
      review_file: testCase.criterionFile,
      files: [testCase.fixtureFile],
      hint: null,
      model: criterion.model,
      status: "pending",
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      context_type: "file",
      context: fixtureContent,
      symbol: null,
      prompt: criterion.prompt,
    };

    // Step 5: Build executor prompt and execute
    const prompt = buildExecutorPrompt(task);
    const executorResult = await executorService.execute(prompt, criterion.model);

    // Step 6: Parse findings
    const findings = parseFindings(executorResult.resultText);

    // Step 7: Update storage with findings and executor usage, move to "judging"
    storage.updateTestCase(runId, testCase.criterionId, testCase.name, {
      status: "judging",
      findings,
      executor_usage: executorResult.usage,
    });

    // Step 8: Read expected.md
    const expectedContent = fs.readFileSync(testCase.expectedFile, "utf-8");

    // Step 9: Judge findings against expectations
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
