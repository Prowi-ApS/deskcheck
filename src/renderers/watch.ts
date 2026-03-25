import type { ReviewPlan, ReviewResults, TaskStatus } from "../types/review.js";

// ANSI codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "○",
  in_progress: "◐",
  complete: "✓",
  error: "✗",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: DIM,
  in_progress: CYAN,
  complete: GREEN,
  error: RED,
};

/** Render a live-progress tree view of a review plan and its results. */
export function renderWatch(plan: ReviewPlan, results: ReviewResults | null): string {
  const lines: string[] = [];
  const tasks = Object.values(plan.tasks);
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === "complete").length;
  const errored = tasks.filter(t => t.status === "error").length;
  const active = tasks.filter(t => t.status === "in_progress").length;
  const pending = tasks.filter(t => t.status === "pending").length;

  // Header
  lines.push("");
  lines.push(`${BOLD}${WHITE}  ${plan.name}${RESET}`);

  // Progress bar
  const barWidth = 30;
  const filled = total > 0 ? Math.round((completed + errored) / total * barWidth) : 0;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);

  const statusParts: string[] = [`${completed + errored}/${total} tasks`];
  if (active > 0) statusParts.push(`${CYAN}${active} active${RESET}`);
  if (pending > 0) statusParts.push(`${DIM}${pending} queued${RESET}`);
  if (errored > 0) statusParts.push(`${RED}${errored} errors${RESET}`);

  // Findings summary
  const findingsParts: string[] = [];
  if (results) {
    const { critical, warning, info } = results.summary;
    if (critical > 0) findingsParts.push(`${RED}${critical}C${RESET}`);
    if (warning > 0) findingsParts.push(`${YELLOW}${warning}W${RESET}`);
    if (info > 0) findingsParts.push(`${BLUE}${info}I${RESET}`);
  }
  const findingsStr = findingsParts.length > 0 ? ` \u2502 ${findingsParts.join(" ")}` : "";

  lines.push(`  ${DIM}${bar}${RESET} ${statusParts.join(" \u2502 ")}${findingsStr}`);
  lines.push("");

  // Tree view: group tasks by module
  const moduleGroups = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const group = moduleGroups.get(task.review_id) ?? [];
    group.push(task);
    moduleGroups.set(task.review_id, group);
  }

  for (const [moduleId, moduleTasks] of moduleGroups) {
    const moduleName = moduleId.split("/").pop() ?? moduleId;

    // Determine module-level status (worst of children)
    let moduleStatus: TaskStatus = "complete";
    let moduleFindings = 0;
    for (const task of moduleTasks) {
      if (task.status === "error") moduleStatus = "error";
      else if (task.status === "in_progress" && moduleStatus !== "error") moduleStatus = "in_progress";
      else if (task.status === "pending" && moduleStatus !== "error" && moduleStatus !== "in_progress") moduleStatus = "pending";

      // Count findings for this task from results
      if (results?.task_results[task.task_id]) {
        moduleFindings += results.task_results[task.task_id].findings.length;
      }
    }

    const moduleColor = STATUS_COLORS[moduleStatus];
    const moduleIcon = STATUS_ICONS[moduleStatus];
    const findingsBadge = moduleFindings > 0
      ? ` ${DIM}(${moduleFindings} findings)${RESET}`
      : moduleStatus === "complete" ? ` ${DIM}(clean)${RESET}` : "";

    lines.push(`  ${moduleColor}${moduleIcon}${RESET} ${BOLD}${moduleName}${RESET}${findingsBadge}`);

    // Child tasks (files)
    for (const task of moduleTasks) {
      const fileName = task.files.map(f => f.split("/").pop()).join(", ");
      const taskColor = STATUS_COLORS[task.status];
      const taskIcon = STATUS_ICONS[task.status];

      let taskSuffix = "";
      if (task.status === "complete" && results?.task_results[task.task_id]) {
        const count = results.task_results[task.task_id].findings.length;
        taskSuffix = count > 0 ? ` ${DIM}(${count} findings)${RESET}` : ` ${DIM}(clean)${RESET}`;
      } else if (task.status === "error") {
        taskSuffix = ` ${RED}(error)${RESET}`;
      }

      lines.push(`    ${taskColor}${taskIcon}${RESET} ${DIM}${fileName}${RESET}${taskSuffix}`);
    }
    lines.push("");
  }

  // Coverage (only if plan has the data)
  if (plan.unmatched_files.length > 0) {
    lines.push(`${DIM}  ${plan.matched_files.length} files covered \u2502 ${plan.unmatched_files.length} not covered${RESET}`);
    lines.push("");
  }

  // Status line
  if (completed + errored >= total && total > 0) {
    lines.push(`  ${GREEN}${BOLD}Deskcheck complete.${RESET} ${DIM}Run 'deskcheck show' for full findings.${RESET}`);
    lines.push("");
  }

  return lines.join("\n");
}
