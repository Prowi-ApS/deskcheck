import type { ReviewPlan, ReviewResults, FindingSeverity, Reference } from "../../types/review.js";
import { groupIssuesBySeveritySection } from "../shared.js";

// ANSI color codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: RED,
  warning: YELLOW,
  info: BLUE,
};

const SEVERITY_ICONS: Record<FindingSeverity, string> = {
  critical: "●",
  warning: "▲",
  info: "○",
};

/** Render review results as colored terminal output. */
export function renderTerminal(
  results: ReviewResults,
  plan?: ReviewPlan,
): string {
  const lines: string[] = [];

  // Header
  const name = plan?.name ?? results.plan_id;
  lines.push("");
  lines.push(`${BOLD}${WHITE}  Deskcheck: ${name}${RESET}`);
  lines.push(`${DIM}  Status: ${results.status} (${results.completion.completed}/${results.completion.total} tasks)${RESET}`);

  if (results.completion.errored > 0) {
    lines.push(`${RED}  Errored: ${results.completion.errored} tasks${RESET}`);
  }

  lines.push("");

  // Summary bar
  const { critical, warning, info } = results.summary;
  const summaryParts: string[] = [];
  if (critical > 0) summaryParts.push(`${RED}${BOLD}${critical} critical${RESET}`);
  if (warning > 0) summaryParts.push(`${YELLOW}${warning} warning${RESET}`);
  if (info > 0) summaryParts.push(`${BLUE}${info} info${RESET}`);

  if (summaryParts.length === 0) {
    lines.push(`  ${GREEN}${BOLD}✓ No findings${RESET}`);
  } else {
    lines.push(`  ${summaryParts.join(`${DIM}  │  ${RESET}`)}`);
  }

  lines.push("");

  // Issues grouped by severity
  const sections = groupIssuesBySeveritySection(results);

  for (const section of sections) {
    const color = SEVERITY_COLORS[section.severity];
    const icon = SEVERITY_ICONS[section.severity];
    lines.push(`${BOLD}${color}  ${icon} ${section.label} (${section.issues.length})${RESET}`);
    lines.push("");

    for (let i = 0; i < section.issues.length; i++) {
      const { issue, reviewId } = section.issues[i]!;

      lines.push(`    ${color}${i + 1}.${RESET} ${issue.description}`);

      // Show references
      for (const ref of issue.references) {
        const location = formatRefLocation(ref);
        lines.push(`       ${DIM}${location}${RESET}  ${DIM}(${reviewId})${RESET}`);
        if (ref.note) {
          lines.push(`       ${DIM}  ${ref.note}${RESET}`);
        }
        if (ref.code) {
          for (const codeLine of ref.code.split("\n")) {
            lines.push(`       ${DIM}  │ ${codeLine}${RESET}`);
          }
        }
        if (ref.suggestedCode) {
          lines.push(`       ${CYAN}  → suggested:${RESET}`);
          for (const codeLine of ref.suggestedCode.split("\n")) {
            lines.push(`       ${CYAN}  │ ${codeLine}${RESET}`);
          }
        }
      }

      if (issue.suggestion) {
        lines.push(`       ${CYAN}→ ${issue.suggestion}${RESET}`);
      }
      lines.push("");
    }
  }

  // Usage summary
  if (results.total_usage && results.total_usage.cost_usd > 0) {
    lines.push(`${DIM}  ─────────────────────────────${RESET}`);
    const u = results.total_usage;
    const totalTokens = u.input_tokens + u.output_tokens;
    const durationSec = (u.duration_ms / 1000).toFixed(1);
    lines.push(`  ${DIM}Tokens: ${totalTokens.toLocaleString()} (${u.input_tokens.toLocaleString()} in, ${u.output_tokens.toLocaleString()} out)${RESET}`);
    lines.push(`  ${DIM}Cost: $${u.cost_usd.toFixed(4)} │ Duration: ${durationSec}s │ Turns: ${u.num_turns}${RESET}`);
    lines.push("");
  }

  // Coverage
  if (plan) {
    lines.push(`${DIM}  ─────────────────────────────${RESET}`);
    lines.push(`${DIM}  Coverage: ${plan.matched_files.length} files reviewed │ ${plan.unmatched_files.length} not covered${RESET}`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Format a reference's location string: prefer symbol, fall back to file:line. */
function formatRefLocation(ref: Reference): string {
  if (ref.symbol) {
    return ref.line ? `${ref.file} ${ref.symbol}:${ref.line}` : `${ref.file} ${ref.symbol}`;
  }
  return ref.line ? `${ref.file}:${ref.line}` : ref.file;
}
