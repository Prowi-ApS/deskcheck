import type { JudgeResult, TestScores } from "../../types/testing.js";

/**
 * Calculate test scores from judge verdicts.
 *
 * Pure math — no LLM, no I/O. Computes recall, precision, and scope
 * compliance from the judge's finding and expectation reviews.
 */
export function calculateScores(judgeResult: JudgeResult): TestScores {
  const { findings_review, expectations_review } = judgeResult;

  // Finding counts by verdict
  const total_findings = findings_review.length;
  const correct = findings_review.filter((f) => f.verdict === "correct").length;
  const out_of_scope = findings_review.filter((f) => f.verdict === "out_of_scope").length;
  const incorrect_severity = findings_review.filter((f) => f.verdict === "incorrect_severity").length;

  // Expectation counts by verdict
  const total_expectations = expectations_review.length;
  const expectations_found = expectations_review.filter((e) => e.verdict === "found").length;
  const expectations_missed = expectations_review.filter((e) => e.verdict === "missed").length;

  // Derived ratios (default to 1.0 when denominator is zero)
  const recall = total_expectations > 0 ? expectations_found / total_expectations : 1.0;
  const precision = total_findings > 0 ? correct / total_findings : 1.0;
  const scope_compliance = total_findings > 0 ? (total_findings - out_of_scope) / total_findings : 1.0;

  return {
    total_findings,
    correct,
    out_of_scope,
    incorrect_severity,
    total_expectations,
    expectations_found,
    expectations_missed,
    recall,
    precision,
    scope_compliance,
  };
}
