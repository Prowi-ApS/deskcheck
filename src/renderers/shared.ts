import type { Issue, FindingSeverity, ReviewResults } from "../core/types.js";

/** An issue tagged with the criterion that produced it. */
export interface TaggedIssue {
  issue: Issue;
  reviewId: string;
}

/** A group of issues sharing the same severity, with a display label. */
export interface SeveritySection {
  severity: FindingSeverity;
  label: string;
  issues: TaggedIssue[];
}

/** Collect all issues of a given severity across all task results. */
export function collectIssuesBySeverity(
  results: ReviewResults,
  severity: FindingSeverity,
): TaggedIssue[] {
  const collected: TaggedIssue[] = [];

  for (const taskResult of Object.values(results.task_results)) {
    for (const issue of taskResult.issues) {
      if (issue.severity === severity) {
        collected.push({ issue, reviewId: taskResult.review_id });
      }
    }
  }

  return collected;
}

/**
 * Group all issues from results into severity sections (critical, warning, info),
 * filtering out sections with zero issues.
 *
 * Used by both terminal and markdown renderers to avoid duplicating the
 * severity iteration and labelling logic.
 */
export function groupIssuesBySeveritySection(results: ReviewResults): SeveritySection[] {
  const all = collectIssuesBySeverity(results, "critical")
    .concat(collectIssuesBySeverity(results, "warning"))
    .concat(collectIssuesBySeverity(results, "info"));

  return ([
    { severity: "critical" as FindingSeverity, label: "Critical Issues", issues: all.filter(f => f.issue.severity === "critical") },
    { severity: "warning" as FindingSeverity, label: "Warnings", issues: all.filter(f => f.issue.severity === "warning") },
    { severity: "info" as FindingSeverity, label: "Info", issues: all.filter(f => f.issue.severity === "info") },
  ] satisfies SeveritySection[]).filter(s => s.issues.length > 0);
}
