import type { ReviewPlan, ReviewResults } from "../../types/review.js";
import { groupFindingsBySeveritySection } from "../shared.js";

/** Render review results as markdown suitable for PR comments. */
export function renderMarkdown(
  results: ReviewResults,
  plan?: ReviewPlan,
): string {
  const lines: string[] = [];

  // Header
  const name = plan?.name ?? results.plan_id;
  lines.push(`## Deskcheck: ${name}`);
  lines.push("");

  const { critical, warning, info, total } = results.summary;
  const completed = results.completion.completed;
  const totalTasks = results.completion.total;
  lines.push(
    `**${total} findings** (${critical} critical, ${warning} warning, ${info} info) | ${completed}/${totalTasks} tasks`,
  );
  lines.push("");

  // Findings grouped by severity
  for (const section of groupFindingsBySeveritySection(results)) {
    lines.push(`### ${section.label}`);
    for (const { finding, reviewId } of section.findings) {
      const location = finding.line
        ? `${finding.file}:${finding.line}`
        : finding.file;
      lines.push(
        `- **${location}** — ${finding.description} *(from ${reviewId})*`,
      );
      if (finding.suggestion) {
        lines.push(`  > ${finding.suggestion}`);
      }
    }
    lines.push("");
  }

  // Coverage
  if (plan) {
    lines.push("### Coverage");
    lines.push(
      `${plan.matched_files.length} files reviewed | ${plan.unmatched_files.length} files not covered by any criterion`,
    );
    lines.push("");
  }

  return lines.join("\n");
}
