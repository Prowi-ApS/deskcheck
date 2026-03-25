import { ExecutorService } from "../ExecutorService.js";
import { buildJudgePrompt } from "../../prompts/JudgePrompt.js";
import type { ReviewConfig } from "../../config/types.js";
import type { ReviewModule } from "../../types/criteria.js";
import type { Finding, TaskUsage } from "../../types/review.js";
import type { JudgeResult } from "../../types/testing.js";

// =============================================================================
// JudgeService
// =============================================================================

/**
 * Spawns a judge agent to evaluate executor findings against expected results.
 *
 * The judge is a pure reasoning agent (haiku model, no tools, single turn)
 * that compares findings to expectations and produces structured verdicts.
 */
export class JudgeService {
  private readonly executorService: ExecutorService;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.executorService = new ExecutorService(config, projectRoot);
  }

  /**
   * Evaluate executor findings against expected results for a criterion.
   *
   * @param criterion - The criterion that was tested.
   * @param expectedContent - Content of expected.md describing what should be found.
   * @param findings - Findings produced by the executor agent.
   * @param fixtureContent - Content of the fixture file that was reviewed.
   * @returns Judge result with finding and expectation reviews, plus usage data.
   */
  async evaluate(
    criterion: ReviewModule,
    expectedContent: string,
    findings: Finding[],
    fixtureContent: string,
  ): Promise<{ result: JudgeResult; usage: TaskUsage | null }> {
    const prompt = buildJudgePrompt(
      criterion.prompt,
      expectedContent,
      findings,
      fixtureContent,
    );

    // Judge uses haiku, no tools, single turn — pure reasoning
    const executorResult = await this.executorService.execute(prompt, "haiku", {
      tools: [],
      maxTurns: 1,
    });

    const result = parseJudgeOutput(executorResult.resultText);

    return { result, usage: executorResult.usage };
  }
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse the judge agent's output into a typed JudgeResult.
 *
 * Looks for a JSON object (not array) in the output, strips markdown fences,
 * and validates the structure. Returns empty results rather than crashing on
 * malformed output.
 */
function parseJudgeOutput(output: string): JudgeResult {
  let jsonText = output.trim();

  // Strip markdown code fences if present
  const fencedMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fencedMatch) {
    jsonText = fencedMatch[1]!.trim();
  }

  // Find the JSON object boundaries
  const startIdx = jsonText.indexOf("{");
  const endIdx = jsonText.lastIndexOf("}");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    console.error(
      `[deskcheck] Warning: judge output did not contain a JSON object. Output: ${output.slice(0, 200)}`,
    );
    return emptyJudgeResult();
  }

  jsonText = jsonText.slice(startIdx, endIdx + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error(
      `[deskcheck] Warning: failed to parse judge JSON output: ${error instanceof Error ? error.message : String(error)}. Output: ${jsonText.slice(0, 200)}`,
    );
    return emptyJudgeResult();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error(
      `[deskcheck] Warning: judge output parsed but was not an object. Type: ${typeof parsed}`,
    );
    return emptyJudgeResult();
  }

  const record = parsed as Record<string, unknown>;

  // Validate structure
  if (!Array.isArray(record.findings_review) || !Array.isArray(record.expectations_review)) {
    console.error(
      `[deskcheck] Warning: judge output missing findings_review or expectations_review arrays.`,
    );
    return emptyJudgeResult();
  }

  return {
    findings_review: record.findings_review as JudgeResult["findings_review"],
    expectations_review: record.expectations_review as JudgeResult["expectations_review"],
  };
}

/** Return an empty judge result for error cases. */
function emptyJudgeResult(): JudgeResult {
  return {
    findings_review: [],
    expectations_review: [],
  };
}
