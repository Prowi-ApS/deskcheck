import type { Finding, FindingSeverity, ReviewResults } from "../types/review.js";

/** A finding tagged with the criterion that produced it. */
export interface TaggedFinding {
  finding: Finding;
  reviewId: string;
}

/** A group of findings sharing the same severity, with a display label. */
export interface SeveritySection {
  severity: FindingSeverity;
  label: string;
  findings: TaggedFinding[];
}

/** Collect all findings of a given severity across all task results. */
export function collectFindingsBySeverity(
  results: ReviewResults,
  severity: FindingSeverity,
): TaggedFinding[] {
  const collected: TaggedFinding[] = [];

  for (const taskResult of Object.values(results.task_results)) {
    for (const finding of taskResult.findings) {
      if (finding.severity === severity) {
        collected.push({ finding, reviewId: taskResult.review_id });
      }
    }
  }

  return collected;
}

/**
 * Group all findings from results into severity sections (critical, warning, info),
 * filtering out sections with zero findings.
 *
 * Used by both terminal and markdown renderers to avoid duplicating the
 * severity iteration and labelling logic.
 */
export function groupFindingsBySeveritySection(results: ReviewResults): SeveritySection[] {
  const all = collectFindingsBySeverity(results, "critical")
    .concat(collectFindingsBySeverity(results, "warning"))
    .concat(collectFindingsBySeverity(results, "info"));

  return ([
    { severity: "critical" as FindingSeverity, label: "Critical Issues", findings: all.filter(f => f.finding.severity === "critical") },
    { severity: "warning" as FindingSeverity, label: "Warnings", findings: all.filter(f => f.finding.severity === "warning") },
    { severity: "info" as FindingSeverity, label: "Info", findings: all.filter(f => f.finding.severity === "info") },
  ] satisfies SeveritySection[]).filter(s => s.findings.length > 0);
}
