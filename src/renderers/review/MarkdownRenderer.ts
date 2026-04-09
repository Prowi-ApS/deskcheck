import type { ReviewPlan, ReviewResults, Reference } from "../../types/review.js";
import { groupIssuesBySeveritySection } from "../shared.js";

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
    `**${total} issues** (${critical} critical, ${warning} warning, ${info} info) | ${completed}/${totalTasks} tasks`,
  );
  lines.push("");

  // Issues grouped by severity
  for (const section of groupIssuesBySeveritySection(results)) {
    lines.push(`### ${section.label}`);
    for (const { issue, reviewId } of section.issues) {
      lines.push(
        `- ${issue.description} *(from ${reviewId})*`,
      );

      // Show references
      for (const ref of issue.references) {
        const location = formatRefLocation(ref);
        lines.push(`  - \`${location}\`${ref.note ? ` — ${ref.note}` : ""}`);
        if (ref.code) {
          lines.push(`    \`\`\`\n    ${ref.code.split("\n").join("\n    ")}\n    \`\`\``);
        }
        if (ref.suggestedCode) {
          lines.push(`    **Suggested:**`);
          lines.push(`    \`\`\`\n    ${ref.suggestedCode.split("\n").join("\n    ")}\n    \`\`\``);
        }
      }

      if (issue.suggestion) {
        lines.push(`  > ${issue.suggestion}`);
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

/** Format a reference's location string for markdown. */
function formatRefLocation(ref: Reference): string {
  const lineRange = ref.startLine > 0
    ? ref.startLine === ref.endLine ? `:${ref.startLine}` : `:${ref.startLine}-${ref.endLine}`
    : "";
  if (ref.symbol) {
    return `${ref.file} ${ref.symbol}${lineRange}`;
  }
  return `${ref.file}${lineRange}`;
}
