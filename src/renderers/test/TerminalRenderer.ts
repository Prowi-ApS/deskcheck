import type {
  TestRun,
  TestCaseResult,
  TestScores,
  TestCaseStatus,
} from "../../types/testing.js";

// =============================================================================
// ANSI helpers
// =============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

// =============================================================================
// Score color helpers
// =============================================================================

/** Color a percentage score: green >= 80%, yellow >= 50%, red < 50%. */
function colorScore(value: number): string {
  const pct = Math.round(value * 100);
  const str = `${pct}%`;
  if (pct >= 80) return `${GREEN}${str}${RESET}`;
  if (pct >= 50) return `${YELLOW}${str}${RESET}`;
  return `${RED}${str}${RESET}`;
}

/** Pad a string to a fixed visible width (ignoring ANSI escape codes). */
function padScore(colored: string, width: number): string {
  // Strip ANSI to measure visible length
  const visible = colored.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - visible.length);
  return colored + " ".repeat(padding);
}

// =============================================================================
// Status icon helpers
// =============================================================================

/** Get the status icon for a test case based on its status and scores. */
function statusIcon(status: TestCaseStatus, scores: TestScores | null): string {
  if (status === "error") return `${RED}\u2717${RESET}`;
  if (status === "pending") return `${DIM}\u25CB${RESET}`;
  if (status === "executing" || status === "judging") return `${DIM}\u27F3${RESET}`;

  // status === "complete"
  if (scores && scores.recall >= 0.8 && scores.precision >= 0.8 && scores.scope_compliance >= 0.8) {
    return `${GREEN}\u2713${RESET}`;
  }
  return `${YELLOW}\u25B2${RESET}`;
}

/** Check if a completed test case passed (all scores >= 80%). */
function isPassing(scores: TestScores | null): boolean {
  if (!scores) return false;
  return scores.recall >= 0.8 && scores.precision >= 0.8 && scores.scope_compliance >= 0.8;
}

// =============================================================================
// Progress renderer (live updates during execution)
// =============================================================================

/**
 * Render the current state of a test run for live progress updates.
 *
 * Shows one line per test case with its current status and scores (if complete).
 */
export function renderTestProgress(run: TestRun): string {
  const lines: string[] = [];
  let totalTests = 0;
  let completedTests = 0;

  for (const [criterionId, suite] of Object.entries(run.suites)) {
    lines.push("");
    lines.push(`  ${BOLD}${criterionId}${RESET}`);
    lines.push("");

    for (const [testName, testCase] of Object.entries(suite.tests)) {
      totalTests++;
      const icon = statusIcon(testCase.status, testCase.scores);

      if (testCase.status === "complete" && testCase.scores) {
        completedTests++;
        const recall = padScore(colorScore(testCase.scores.recall), 6);
        const precision = padScore(colorScore(testCase.scores.precision), 6);
        const scope = padScore(colorScore(testCase.scores.scope_compliance), 6);
        lines.push(`    ${icon} ${testName}       recall: ${recall}precision: ${precision}scope: ${scope}`);

        // Summary line
        const parts: string[] = [];
        if (testCase.scores.expectations_found > 0 || testCase.scores.total_expectations > 0) {
          parts.push(`${testCase.scores.expectations_found}/${testCase.scores.total_expectations} expected found`);
        }
        if (testCase.scores.out_of_scope > 0) {
          parts.push(`${testCase.scores.out_of_scope} out-of-scope finding${testCase.scores.out_of_scope !== 1 ? "s" : ""}`);
        }
        if (parts.length > 0) {
          lines.push(`      ${DIM}${parts.join(". ")}.${RESET}`);
        }
      } else if (testCase.status === "error") {
        completedTests++;
        lines.push(`    ${icon} ${testName}       ${RED}error${RESET}`);
        if (testCase.error) {
          lines.push(`      ${DIM}${testCase.error}${RESET}`);
        }
      } else if (testCase.status === "executing") {
        lines.push(`    ${icon} ${testName}       ${DIM}executing...${RESET}`);
      } else if (testCase.status === "judging") {
        lines.push(`    ${icon} ${testName}       ${DIM}judging...${RESET}`);
      } else {
        // pending
        lines.push(`    ${icon} ${testName}       ${DIM}pending${RESET}`);
      }
    }
  }

  lines.push("");
  lines.push(`  ${completedTests}/${totalTests} complete`);

  return lines.join("\n");
}

// =============================================================================
// Results renderer (final detailed output)
// =============================================================================

/**
 * Render the final detailed results after all tests complete.
 *
 * For imperfect or failed tests, shows per-finding and per-expectation detail.
 */
export function renderTestResults(run: TestRun): string {
  const lines: string[] = [];
  let totalSuites = 0;
  let passedSuites = 0;
  let imperfectSuites = 0;
  let totalCost = 0;
  let totalDuration = 0;

  for (const [criterionId, suite] of Object.entries(run.suites)) {
    totalSuites++;
    lines.push("");
    lines.push(`  ${BOLD}${criterionId}${RESET}`);
    lines.push("");

    let suiteAllPassing = true;

    for (const [testName, testCase] of Object.entries(suite.tests)) {
      // Accumulate cost and duration
      totalCost += accumulateCost(testCase);
      totalDuration += accumulateDuration(testCase);

      const icon = statusIcon(testCase.status, testCase.scores);

      if (testCase.status === "complete" && testCase.scores) {
        const passing = isPassing(testCase.scores);
        if (!passing) suiteAllPassing = false;

        const recall = padScore(colorScore(testCase.scores.recall), 6);
        const precision = padScore(colorScore(testCase.scores.precision), 6);
        const scope = padScore(colorScore(testCase.scores.scope_compliance), 6);
        lines.push(`    ${icon} ${testName}       recall: ${recall}precision: ${precision}scope: ${scope}`);

        // Show detail for imperfect tests
        if (!passing && testCase.judge) {
          lines.push("");

          // Findings detail
          if (testCase.judge.findings_review.length > 0) {
            lines.push(`      ${BOLD}Findings:${RESET}`);
            for (const fr of testCase.judge.findings_review) {
              if (fr.verdict === "correct") {
                const check = fr.criterion_check ? ` ${DIM}(${fr.criterion_check})${RESET}` : "";
                lines.push(`        ${GREEN}\u2713${RESET} ${fr.finding}          ${DIM}correct${RESET}${check}`);
              } else if (fr.verdict === "out_of_scope") {
                lines.push(`        ${RED}\u2717${RESET} ${fr.finding}          ${YELLOW}out of scope${RESET}`);
              } else {
                lines.push(`        ${RED}\u2717${RESET} ${fr.finding}          ${RED}incorrect severity${RESET}`);
              }
            }
            lines.push("");
          }

          // Expectations detail
          if (testCase.judge.expectations_review.length > 0) {
            lines.push(`      ${BOLD}Expectations:${RESET}`);
            for (const er of testCase.judge.expectations_review) {
              if (er.verdict === "found") {
                lines.push(`        ${GREEN}\u2713${RESET} ${er.expectation}          ${DIM}found${RESET}`);
              } else {
                lines.push(`        ${RED}\u2717${RESET} ${er.expectation}          ${RED}missed${RESET}`);
              }
            }
          }

          lines.push("");
        }
      } else if (testCase.status === "error") {
        suiteAllPassing = false;
        lines.push(`    ${icon} ${testName}       ${RED}error: ${testCase.error ?? "unknown"}${RESET}`);
        lines.push("");
      } else {
        suiteAllPassing = false;
        lines.push(`    ${icon} ${testName}       ${DIM}${testCase.status}${RESET}`);
      }
    }

    if (suiteAllPassing) {
      passedSuites++;
    } else {
      imperfectSuites++;
    }
  }

  // Summary line
  lines.push("");
  const summaryParts: string[] = [];
  if (passedSuites > 0) summaryParts.push(`${GREEN}${passedSuites} passed${RESET}`);
  if (imperfectSuites > 0) summaryParts.push(`${YELLOW}${imperfectSuites} imperfect${RESET}`);
  lines.push(`  Results: ${summaryParts.join(", ")} (${totalSuites} total)`);

  // Cost and duration
  const costStr = totalCost > 0 ? `$${totalCost.toFixed(2)}` : "$0.00";
  const durationStr = `${Math.round(totalDuration / 1000)}s`;
  lines.push(`  ${DIM}Cost: ${costStr} \u2502 Duration: ${durationStr}${RESET}`);
  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// Usage accumulation helpers
// =============================================================================

function accumulateCost(testCase: TestCaseResult): number {
  let cost = 0;
  if (testCase.executor_usage) cost += testCase.executor_usage.cost_usd;
  if (testCase.judge_usage) cost += testCase.judge_usage.cost_usd;
  return cost;
}

function accumulateDuration(testCase: TestCaseResult): number {
  let duration = 0;
  if (testCase.executor_usage) duration += testCase.executor_usage.duration_ms;
  if (testCase.judge_usage) duration += testCase.judge_usage.duration_ms;
  return duration;
}
