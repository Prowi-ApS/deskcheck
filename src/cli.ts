#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG } from "./core/config.js";
import { ReviewStorage } from "./core/storage.js";
import { discoverModules } from "./core/module-parser.js";
import { buildPlanWithTasks } from "./core/plan-builder.js";
import { ReviewPlanner } from "./agents/planner.js";
import { ReviewOrchestrator } from "./agents/orchestrator.js";
import { renderTerminal } from "./renderers/terminal.js";
import { renderMarkdown } from "./renderers/markdown.js";
import { renderJson } from "./renderers/json.js";
import { renderWatch } from "./renderers/watch.js";
import { startServer } from "./serve.js";
import type { ReviewResults, ReviewPlan, FindingSeverity } from "./core/types.js";

// =============================================================================
// ANSI helpers
// =============================================================================

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

// =============================================================================
// Helpers
// =============================================================================

function resolveProjectRoot(): string {
  return process.cwd();
}

function formatFindingsSummary(results: ReviewResults): string {
  const { critical, warning, info, total } = results.summary;
  if (total === 0) return "0";
  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical}C`);
  if (warning > 0) parts.push(`${warning}W`);
  if (info > 0) parts.push(`${info}I`);
  return `${total} (${parts.join(" ")})`;
}

function padEnd(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

/** Check if findings exceed the --fail-on threshold. Returns the exit code. */
function checkFailOn(results: ReviewResults, failOn: string | undefined): number {
  if (!failOn) return 0;

  const severities = failOn.split(",").map((s) => s.trim().toLowerCase());

  for (const severity of severities) {
    if (severity === "critical" && results.summary.critical > 0) return 1;
    if (severity === "warning" && (results.summary.critical > 0 || results.summary.warning > 0)) return 1;
    if (severity === "info" && results.summary.total > 0) return 1;
  }

  return 0;
}

/** Render results in the requested format. */
function renderOutput(results: ReviewResults, plan: ReviewPlan, format: string): string {
  switch (format) {
    case "terminal":
      return renderTerminal(results, plan);
    case "markdown":
      return renderMarkdown(results, plan);
    case "json":
      return renderJson(results);
    default:
      return renderTerminal(results, plan);
  }
}

/** Print execution progress from orchestrator events. */
async function executeAndPrint(
  orchestrator: ReviewOrchestrator,
  planId: string,
): Promise<void> {
  console.log(`${DIM}  Checking...${RESET}`);
  console.log("");

  for await (const event of orchestrator.execute(planId)) {
    switch (event.type) {
      case "task_started":
        break;
      case "task_completed": {
        const moduleName = event.reviewId.split("/").pop() ?? event.reviewId;
        const fileName = event.files.map((f) => f.split("/").pop()).join(", ");
        if (event.issueCount > 0) {
          console.log(`${YELLOW}  ▲ ${moduleName}${RESET} ${DIM}→${RESET} ${fileName} ${DIM}(${event.issueCount} issues)${RESET}`);
        } else {
          console.log(`${GREEN}  ✓ ${moduleName}${RESET} ${DIM}→${RESET} ${fileName} ${DIM}(clean)${RESET}`);
        }
        break;
      }
      case "task_error": {
        const errModuleName = event.reviewId.split("/").pop() ?? event.reviewId;
        const errFileName = event.files.map((f) => f.split("/").pop()).join(", ");
        console.log(`${RED}  ✗ ${errModuleName}${RESET} ${DIM}→${RESET} ${errFileName} ${DIM}(error)${RESET}`);
        break;
      }
      case "batch_progress":
        if (event.total > 10) {
          console.log(`${DIM}  [${event.completed}/${event.total}]${RESET}`);
        }
        break;
      case "complete":
        console.log("");
        break;
    }
  }
}

/** Print the plan summary after planning. */
function printPlanSummary(plan: ReviewPlan): void {
  const taskCount = Object.keys(plan.tasks).length;
  const moduleNames = Object.keys(plan.modules).map((id) => id.split("/").pop()).join(", ");
  console.log("");
  console.log(`${BOLD}  ${plan.name}${RESET}`);
  console.log(`${DIM}  ${taskCount} tasks │ modules: ${moduleNames}${RESET}`);
  if (plan.unmatched_files.length > 0) {
    console.log(`${DIM}  ${plan.unmatched_files.length} files not covered by any criterion${RESET}`);
  }
  console.log("");
}

// =============================================================================
// Commands
// =============================================================================

/** `deskcheck init` */
function initCommand(): void {
  const projectRoot = resolveProjectRoot();
  const deskchecDir = path.join(projectRoot, ".deskcheck");
  const configPath = path.join(deskchecDir, "config.json");
  const modulesDir = path.join(projectRoot, "deskcheck", "criteria");

  let created = false;

  if (!fs.existsSync(deskchecDir)) {
    fs.mkdirSync(deskchecDir, { recursive: true });
    console.log(`Created ${deskchecDir}/`);
    created = true;
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    console.log(`Created ${configPath}`);
    created = true;
  } else {
    console.log(`Config already exists: ${configPath}`);
  }

  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir, { recursive: true });
    console.log(`Created ${modulesDir}/`);
    created = true;
  } else {
    console.log(`Criteria directory already exists: ${modulesDir}/`);
  }

  if (!created) {
    console.log("Already initialized — nothing to do.");
  }
}

/** `deskcheck list` */
function listCommand(): void {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storage = new ReviewStorage(path.join(projectRoot, config.storage_dir));

  const plans = storage.listPlans();

  if (plans.length === 0) {
    console.log("No deskcheck runs found.");
    return;
  }

  console.log(`${padEnd("ID", 22)}${padEnd("Name", 40)}${padEnd("Status", 12)}Findings`);

  for (const plan of plans) {
    let findingsStr = "-";
    try {
      const results = storage.getResults(plan.planId);
      if (results.summary.total > 0 || plan.status === "complete") {
        findingsStr = formatFindingsSummary(results);
      }
    } catch {
      // No results file yet
    }

    console.log(`${padEnd(plan.planId, 22)}${padEnd(plan.name, 40)}${padEnd(plan.status, 12)}${findingsStr}`);
  }
}

/** `deskcheck show [id]` */
function showCommand(id: string | undefined, options: { format: string; failOn?: string }): void {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storage = new ReviewStorage(path.join(projectRoot, config.storage_dir));

  const planId = id ?? storage.getLatestPlanId();
  if (!planId) {
    console.error("No deskcheck runs found.");
    process.exit(1);
  }

  let plan: ReviewPlan;
  let results: ReviewResults;

  try { plan = storage.getPlan(planId); } catch {
    console.error(`Plan not found: ${planId}`);
    process.exit(1);
  }

  try { results = storage.getResults(planId); } catch {
    console.error(`Results not found for plan: ${planId}`);
    process.exit(1);
  }

  console.log(renderOutput(results, plan!, options.format));
  process.exit(checkFailOn(results, options.failOn));
}

/** `deskcheck diff [...git-args]` — deterministic, no LLM planner. */
async function diffCommand(
  gitArgs: string[],
  options: { format: string; failOn?: string; dryRun: boolean; concurrency: number },
): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storageDir = path.join(projectRoot, config.storage_dir);
  const storage = new ReviewStorage(storageDir);

  // Get changed files via git diff
  // Insert --name-only right after "diff" so it comes before any -- path separators
  const gitDiffArgs = ["diff", "--name-only", ...gitArgs];
  let fileOutput: string;
  try {
    fileOutput = execFileSync("git", gitDiffArgs, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 30_000,
    });
  } catch (err) {
    console.error(`${RED}Failed to run: git ${gitDiffArgs.join(" ")}${RESET}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const files = fileOutput.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  if (files.length === 0) {
    console.log("No changed files found.");
    process.exit(0);
  }

  // Discover modules and build plan
  const modulesDir = path.resolve(projectRoot, config.modules_dir);
  const modules = discoverModules(modulesDir);

  // Build a human-readable name from git args
  const diffTarget = gitArgs.filter((a) => !a.startsWith("--")).join(" ") || "working tree";
  const planName = `diff: ${diffTarget}`;
  const sourceTarget = gitArgs[0] ?? "HEAD";
  const source = { type: "diff" as const, target: sourceTarget };

  const plan = buildPlanWithTasks(storage, planName, source, files, modules);

  printPlanSummary(plan);

  if (options.dryRun) {
    console.log(`${DIM}  Dry run — plan created but not executed.${RESET}`);
    console.log(`${DIM}  Plan ID: ${plan.plan_id}${RESET}`);
    process.exit(0);
  }

  if (Object.keys(plan.tasks).length === 0) {
    console.log(`${DIM}  No criteria matched the changed files.${RESET}`);
    process.exit(0);
  }

  // Execute
  const orchestrator = new ReviewOrchestrator(config, projectRoot);
  await executeAndPrint(orchestrator, plan.plan_id);

  // Render results
  const finalPlan = storage.getPlan(plan.plan_id);
  const results = storage.getResults(plan.plan_id);
  console.log(renderOutput(results, finalPlan, options.format));
  process.exit(checkFailOn(results, options.failOn));
}

/** Default command — natural language deskcheck via LLM planner. */
async function deskchecCommand(
  prompt: string,
  options: { failOn?: string },
): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storageDir = path.join(projectRoot, config.storage_dir);

  console.log(`${DIM}Planning...${RESET}`);
  const planner = new ReviewPlanner(config, projectRoot);
  const plan = await planner.plan(prompt);

  printPlanSummary(plan);

  // Execute
  const orchestrator = new ReviewOrchestrator(config, projectRoot);
  await executeAndPrint(orchestrator, plan.plan_id);

  // Render results
  const storage = new ReviewStorage(storageDir);
  const finalPlan = storage.getPlan(plan.plan_id);
  const results = storage.getResults(plan.plan_id);
  console.log(renderTerminal(results, finalPlan));
  process.exit(checkFailOn(results, options.failOn));
}

/** `deskcheck watch [plan-id]` */
async function watchCommand(planId?: string): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storage = new ReviewStorage(path.join(projectRoot, config.storage_dir));

  const resolvedId = planId ?? storage.getLatestPlanId();
  if (!resolvedId) {
    console.error("No deskcheck runs found. Start a deskcheck first.");
    process.exit(1);
  }

  let lastPlanMtime = 0;
  let lastResultsMtime = 0;

  const planPath = path.join(projectRoot, config.storage_dir, resolvedId, "plan.json");
  const resultsPath = path.join(projectRoot, config.storage_dir, resolvedId, "results.json");

  const render = (): void => {
    try {
      const planMtime = fs.statSync(planPath).mtimeMs;
      const resultsMtime = fs.existsSync(resultsPath) ? fs.statSync(resultsPath).mtimeMs : 0;

      if (planMtime === lastPlanMtime && resultsMtime === lastResultsMtime) return;
      lastPlanMtime = planMtime;
      lastResultsMtime = resultsMtime;

      const plan = storage.getPlan(resolvedId);
      let results: ReviewResults | null = null;
      try { results = storage.getResults(resolvedId); } catch { /* no results yet */ }

      // Clear screen and render
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(renderWatch(plan, results));

      // Auto-exit when complete
      if (plan.status === "complete") {
        clearInterval(interval);
      }
    } catch {
      // JSON parse error during mid-write — skip this tick, retry next
    }
  };

  // Initial render
  render();

  // Poll every second
  const interval = setInterval(render, 1000);

  // Graceful Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log("");
    process.exit(0);
  });
}

// =============================================================================
// Program
// =============================================================================

const program = new Command();

program
  .name("deskcheck")
  .description("Modular code deskcheck tool powered by Claude")
  .version("0.2.0");

// Default command: natural language deskcheck
program
  .argument("[prompt]", "What to check (natural language)")
  .option("--fail-on <severities>", "Exit non-zero if findings match: critical, warning, info (comma-separated)")
  .action(async (prompt: string | undefined, options: { failOn?: string }) => {
    if (!prompt) {
      program.help();
      return;
    }
    try {
      await deskchecCommand(prompt, options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Subcommand: diff — deterministic, no LLM
program
  .command("diff")
  .description("Check git diff changes (no LLM planner — deterministic)")
  .argument("[git-args...]", "Arguments passed to git diff (e.g., develop, --staged, HEAD~3)")
  .option("--format <format>", "Output format: terminal, markdown, json", "terminal")
  .option("--fail-on <severities>", "Exit non-zero if findings match: critical, warning, info")
  .option("--dry-run", "Show the plan without executing", false)
  .option("--concurrency <n>", "Max concurrent executor agents", "5")
  .addHelpText("after", `
Examples:
  deskcheck diff develop              Check changes vs develop branch
  deskcheck diff --staged             Check staged changes
  deskcheck diff HEAD~3               Check last 3 commits
  deskcheck diff main -- app/         Check changes in app/ vs main
  deskcheck diff develop --dry-run    Show plan without executing
  deskcheck diff develop --fail-on=critical  Exit non-zero on critical findings
  `)
  .action(async (gitArgs: string[], options: { format: string; failOn?: string; dryRun: boolean; concurrency: string }) => {
    try {
      await diffCommand(gitArgs, {
        ...options,
        concurrency: parseInt(options.concurrency, 10) || 5,
      });
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Subcommand: init
program
  .command("init")
  .description("Initialize deskcheck configuration and directories")
  .action(() => {
    try { initCommand(); } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Subcommand: list
program
  .command("list")
  .description("List all deskcheck runs")
  .action(() => {
    try { listCommand(); } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Subcommand: show
program
  .command("show")
  .argument("[id]", "Plan ID (defaults to latest)")
  .option("--format <format>", "Output format: terminal, markdown, json", "terminal")
  .option("--fail-on <severities>", "Exit non-zero if findings match: critical, warning, info")
  .description("Show results for a deskcheck run")
  .action((id: string | undefined, options: { format: string; failOn?: string }) => {
    try { showCommand(id, options); } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Subcommand: watch
program
  .command("watch")
  .argument("[plan-id]", "Plan ID to watch (defaults to latest)")
  .description("Watch a deskcheck in progress — live tree view")
  .action(async (planId?: string) => {
    try {
      await watchCommand(planId);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Subcommand: serve
program
  .command("serve")
  .description("Start web UI for viewing deskcheck runs")
  .option("--port <port>", "Port number (overrides config serve_port)")
  .action((options: { port?: string }) => {
    try {
      const projectRoot = resolveProjectRoot();
      const config = loadConfig(projectRoot);
      const port = options.port ? parseInt(options.port, 10) : config.serve_port;
      startServer(config, projectRoot, port);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();
