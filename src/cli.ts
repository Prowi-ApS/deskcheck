#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG } from "./config/loader.js";
import { ReviewStorageService } from "./services/review/ReviewStorageService.js";
import { discoverModules, filterModules } from "./services/criteria/module-parser.js";
import { buildPlanWithTasks } from "./services/review/ReviewPlanBuilderService.js";
import { ReviewInputResolverService } from "./services/review/ReviewInputResolverService.js";
import { ReviewPartitionerService } from "./services/review/ReviewPartitionerService.js";
import { ReviewOrchestratorService } from "./services/review/ReviewOrchestratorService.js";
import { renderTerminal } from "./renderers/review/TerminalRenderer.js";
import { renderMarkdown } from "./renderers/review/MarkdownRenderer.js";
import { renderJson } from "./renderers/review/JsonRenderer.js";
import { renderWatch } from "./renderers/review/WatchRenderer.js";
import { startServer } from "./server/server.js";
import { discoverTests } from "./services/testing/TestDiscoveryService.js";
import { TestRunnerService } from "./services/testing/TestRunnerService.js";
import { renderTestResults } from "./renderers/test/TerminalRenderer.js";
import type { ReviewResults, ReviewPlan, Scope, PlanInvocation, FindingSeverity } from "./types/review.js";
import type { TestCaseResult } from "./types/testing.js";

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

/** Build the PlanInvocation snapshot for storage from the current process. */
function captureInvocation(projectRoot: string): PlanInvocation {
  return {
    command: "deskcheck",
    args: process.argv.slice(2),
    cwd: projectRoot,
  };
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
  orchestrator: ReviewOrchestratorService,
  planId: string,
  maxConcurrent?: number,
): Promise<void> {
  console.log(`${DIM}  Checking...${RESET}`);
  console.log("");

  for await (const event of orchestrator.execute(planId, { maxConcurrent })) {
    switch (event.type) {
      case "task_started":
        break;
      case "task_completed": {
        const moduleName = event.reviewId.split("/").pop() ?? event.reviewId;
        const fileName = event.files.map((f) => f.split("/").pop()).join(", ");
        if (event.issueCount > 0) {
          console.log(`${YELLOW}  ▲ ${moduleName}${RESET} ${DIM}→${RESET} ${fileName} ${DIM}(${event.issueCount} findings)${RESET}`);
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
  const exampleCriterion = path.join(modulesDir, "example.md");

  let created = false;

  if (!fs.existsSync(deskchecDir)) {
    fs.mkdirSync(deskchecDir, { recursive: true });
    console.log(`  Created ${DIM}.deskcheck/${RESET}`);
    created = true;
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, ANNOTATED_CONFIG);
    console.log(`  Created ${DIM}.deskcheck/config.json${RESET}`);
    created = true;
  } else {
    console.log(`  Config already exists: ${DIM}.deskcheck/config.json${RESET}`);
  }

  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir, { recursive: true });
    console.log(`  Created ${DIM}deskcheck/criteria/${RESET}`);
    created = true;
  } else {
    console.log(`  Criteria directory already exists: ${DIM}deskcheck/criteria/${RESET}`);
  }

  if (!fs.existsSync(exampleCriterion)) {
    fs.writeFileSync(exampleCriterion, EXAMPLE_CRITERION);
    console.log(`  Created ${DIM}deskcheck/criteria/example.md${RESET}`);
    created = true;
  }

  if (!created) {
    console.log("Already initialized — nothing to do.");
    return;
  }

  console.log("");
  console.log(`${BOLD}  Next steps:${RESET}`);
  console.log(`${DIM}  1. Edit deskcheck/criteria/example.md (or create your own criterion files)${RESET}`);
  console.log(`${DIM}  2. Run: deskcheck diff main${RESET}`);
  console.log(`${DIM}  3. View results: deskcheck serve${RESET}`);
  console.log("");
  console.log(`${DIM}  Run ${BOLD}deskcheck init --explain${RESET}${DIM} to see all config options.${RESET}`);
}

/** `deskcheck init --explain` — print a detailed reference of all config options. */
function explainConfig(): void {
  console.log(`
${BOLD}Deskcheck Configuration Reference${RESET}
${DIM}Config file: .deskcheck/config.json${RESET}

${BOLD}Top-level fields:${RESET}

  ${GREEN}modules_dir${RESET}     ${DIM}(string, default: "deskcheck/criteria")${RESET}
    Directory containing criterion markdown files. Scanned recursively.

  ${GREEN}storage_dir${RESET}     ${DIM}(string, default: ".deskcheck/runs")${RESET}
    Where run data (plan.json, results.json, agent logs) is stored.

  ${GREEN}tests_dir${RESET}       ${DIM}(string, default: "deskcheck/tests")${RESET}
    Directory for criterion test fixtures (used by \`deskcheck test\`).

  ${GREEN}serve_port${RESET}      ${DIM}(number, default: 3000)${RESET}
    Port for the web dashboard (\`deskcheck serve\`).

  ${GREEN}concurrency${RESET}     ${DIM}(number, default: 5)${RESET}
    Max concurrent reviewer agents. CLI flag --concurrency overrides this.

  ${GREEN}defaultModel${RESET}    ${DIM}(string, default: "sonnet")${RESET}
    Default Claude model for the pipeline. Used by:
    - Criterion \`model\` when not specified in frontmatter
    - Resolver agent (unless agents.resolver.model overrides)
    - Partitioner agent (unless agents.partitioner.model overrides)
    Values: "haiku", "sonnet", "opus"

${BOLD}shared:${RESET} ${DIM}— configuration shared across all agent roles${RESET}

  ${GREEN}shared.allowed_tools${RESET}   ${DIM}(string[], default: ["Read", "Glob", "Grep"])${RESET}
    Tools available to reviewer agents on top of built-ins.
    Built-in tools (Read, Grep, Glob, Bash) are ALWAYS available
    regardless of this setting. Add extras here like "WebFetch".

  ${GREEN}shared.mcp_servers${RESET}    ${DIM}(object, default: {})${RESET}
    MCP servers available to all reviewer agents.
    Each entry: { "name": { "command": "...", "args": [...], "env": {...} } }
    ${YELLOW}Note: deskcheck never inherits MCP servers from your Claude Code
    config. Only servers listed here (or per-role) are available.${RESET}

${BOLD}agents:${RESET} ${DIM}— per-role agent configuration${RESET}

  Each role has the same shape: { model?, additional_tools?, additional_mcp_servers? }

  ${GREEN}agents.resolver${RESET}      ${DIM}(default model: from defaultModel)${RESET}
    The natural-language input resolver. Only used by \`deskcheck "<prompt>"\`.
    Resolves the user's request into { scope, files }. Gets built-in tools only.
    Set \`"model"\` to override defaultModel for this role only.

  ${GREEN}agents.partitioner${RESET}  ${DIM}(default model: from defaultModel)${RESET}
    Splits matched files into subtasks per criterion. One agent per criterion.
    Gets built-in tools only. additional_tools/additional_mcp_servers are ignored.
    Set \`"model"\` to override defaultModel for this role only.

  ${GREEN}agents.reviewer${RESET}     ${DIM}(default model: per-criterion frontmatter, falls back to defaultModel)${RESET}
    The reviewer agents. Model comes from the criterion's \`model:\` field.
    If the criterion doesn't specify a model, \`defaultModel\` is used.
    Use this to add tools/MCP servers to all reviewers:
      "reviewer": {
        "additional_tools": ["WebFetch"],
        "additional_mcp_servers": {
          "my-db": { "command": "npx", "args": ["@my/db-mcp"] }
        }
      }

  ${GREEN}agents.evaluator${RESET}    ${DIM}(default model: "haiku")${RESET}
    Used by \`deskcheck test\` to run criteria against fixture files.

  ${GREEN}agents.judge${RESET}        ${DIM}(default model: "opus")${RESET}
    Used by \`deskcheck test\` to score findings against expectations.

${BOLD}Criterion frontmatter fields:${RESET}

  ${GREEN}description${RESET}   ${DIM}(required)${RESET}  Human-readable description
  ${GREEN}globs${RESET}         ${DIM}(required)${RESET}  File patterns to match. Prefix with ! to exclude.
  ${GREEN}partition${RESET}     ${DIM}(optional, default: "one task per matched file")${RESET}
                Natural-language instruction for how to split files into subtasks.
                Examples: "one task per file", "one public method per task",
                          "group each test with its source file"
  ${GREEN}model${RESET}         ${DIM}(optional, default: "haiku")${RESET}
                Claude model for reviewer agents: haiku, sonnet, opus.
                ${YELLOW}Use sonnet if the criterion has "What NOT to check" rules.${RESET}
  ${GREEN}tools${RESET}         ${DIM}(optional, default: [])${RESET}
                Extra tools for reviewers running this criterion.
                Layered on top of built-ins + shared + executor tools.

${BOLD}Example config:${RESET}

  {
    "modules_dir": "deskcheck/criteria",
    "storage_dir": ".deskcheck/runs",
    "serve_port": 3000,
    "concurrency": 5,
    "defaultModel": "sonnet",
    "shared": {
      "allowed_tools": ["Read", "Glob", "Grep"],
      "mcp_servers": {}
    },
    "agents": {
      "resolver": {},
      "partitioner": {},
      "reviewer": {},
      "evaluator": { "model": "haiku" },
      "judge": { "model": "opus" }
    }
  }
`);
}

// =============================================================================
// Init templates
// =============================================================================

const ANNOTATED_CONFIG = `{
  "modules_dir": "deskcheck/criteria",
  "storage_dir": ".deskcheck/runs",
  "tests_dir": "deskcheck/tests",
  "serve_port": 3000,
  "concurrency": 5,
  "defaultModel": "sonnet",
  "shared": {
    "allowed_tools": ["Read", "Glob", "Grep"],
    "mcp_servers": {}
  },
  "agents": {
    "resolver": {},
    "partitioner": {},
    "reviewer": {},
    "evaluator": { "model": "haiku" },
    "judge": { "model": "opus" }
  }
}
`;

const EXAMPLE_CRITERION = `---
description: Example criterion — checks for TODO/FIXME comments
globs:
  - "src/**/*.ts"
  - "src/**/*.js"
  - "!src/**/*.test.*"
partition: one task per file
model: haiku
---

Check the assigned files for TODO, FIXME, HACK, or XXX comments.
(This example uses haiku since it's a simple pattern match — no judgment needed.)

For each one found, report:
- severity: "info"
- description: what the comment says
- suggestion: null (these are just informational)

If no such comments exist, return an empty array.

This is a starter criterion to verify your setup works. Replace it with
criteria that match your project's review needs.
`;

/** `deskcheck list` */
function listCommand(): void {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storage = new ReviewStorageService(path.join(projectRoot, config.storage_dir));

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
  const storage = new ReviewStorageService(path.join(projectRoot, config.storage_dir));

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
  options: { format: string; failOn?: string; dryRun: boolean; concurrency: number; criteria?: string },
): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storageDir = path.join(projectRoot, config.storage_dir);
  const storage = new ReviewStorageService(storageDir);

  // Resolve the diff ref. The first positional (non-flag) arg becomes the ref;
  // with no positional, default to HEAD. This is the same ref the reviewer
  // will use later (`git diff <ref> -- <file>`), so file discovery and the
  // reviewer's per-file diffs see the same baseline. Bare `deskcheck diff`
  // therefore reviews working-tree-vs-HEAD = staged + unstaged combined.
  const ref = gitArgs.find((a) => !a.startsWith("-")) ?? "HEAD";
  const passthrough = gitArgs.filter((a) => a !== ref);
  const gitDiffArgs = ["diff", "--name-only", ref, ...passthrough];
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

  // Discover modules and optionally filter by --criteria
  const modulesDir = path.resolve(projectRoot, config.modules_dir);
  let modules = discoverModules(modulesDir, config.defaultModel);

  if (options.criteria) {
    const patterns = options.criteria.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    modules = filterModules(modules, patterns);
  }

  // Build a human-readable plan name and the structured scope.
  const planName = `diff: ${ref}`;
  const scope = { type: "changes" as const, ref };
  const invocation = captureInvocation(projectRoot);

  const partitioner = new ReviewPartitionerService(config, projectRoot);
  const plan = await buildPlanWithTasks(
    storage,
    partitioner,
    planName,
    scope,
    invocation,
    files,
    modules,
    {
      onMatchingComplete: (criteriaCount, fileCount) => {
        console.log(
          `${DIM}  Matching: ${criteriaCount} criteria matched ${fileCount} file(s)${RESET}`,
        );
        if (criteriaCount > 0) {
          console.log(`${DIM}  Partitioning...${RESET}`);
        }
      },
      onPartitionCompleted: (decision) => {
        const name = decision.review_id.split("/").pop() ?? decision.review_id;
        console.log(
          `${DIM}    ${name}: ${decision.subtasks.length} subtask(s) from ${decision.matched_files.length} file(s)${RESET}`,
        );
      },
    },
  );

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

  // Execute. CLI --concurrency overrides config.concurrency.
  const maxConcurrent = options.concurrency || config.concurrency;
  const orchestrator = new ReviewOrchestratorService(config, projectRoot);
  try {
    await executeAndPrint(orchestrator, plan.plan_id, maxConcurrent);
  } catch (err) {
    storage.setFailure(plan.plan_id, {
      step: "reviewing",
      review_id: null,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // Render results
  const finalPlan = storage.getPlan(plan.plan_id);
  const results = storage.getResults(plan.plan_id);
  console.log(renderOutput(results, finalPlan, options.format));
  process.exit(checkFailOn(results, options.failOn));
}

/**
 * Parse the `--scope` flag value into a structured Scope.
 *
 * Accepted forms:
 *   all                   → { type: "all" }
 *   changes               → { type: "changes", ref: "HEAD" }
 *   changes:<ref>         → { type: "changes", ref: "<ref>" }
 */
function parseScopeFlag(value: string): Scope {
  const trimmed = value.trim();
  if (trimmed === "all") return { type: "all" };
  if (trimmed === "changes") return { type: "changes", ref: "HEAD" };
  if (trimmed.startsWith("changes:")) {
    const ref = trimmed.slice("changes:".length).trim();
    if (!ref) throw new Error(`--scope changes: requires a ref (e.g. changes:main)`);
    return { type: "changes", ref };
  }
  throw new Error(`Invalid --scope value: "${value}". Expected "all", "changes", or "changes:<ref>".`);
}

/** Default command — natural-language deskcheck via the input resolver agent. */
async function deskchecCommand(
  prompt: string,
  options: { failOn?: string; criteria?: string; scope?: string },
): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storageDir = path.join(projectRoot, config.storage_dir);
  const storage = new ReviewStorageService(storageDir);

  const scopeOverride = options.scope ? parseScopeFlag(options.scope) : undefined;
  const criteriaFilter = options.criteria
    ? options.criteria.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : undefined;

  // Step 1: resolve { scope, files } from natural language.
  console.log(`${DIM}Resolving...${RESET}`);
  const resolver = new ReviewInputResolverService(config, projectRoot);
  const { scope, files } = await resolver.resolve(prompt, scopeOverride);

  // Step 2: discover and filter criteria (programmatic, no LLM).
  const modulesDir = path.resolve(projectRoot, config.modules_dir);
  let modules = discoverModules(modulesDir, config.defaultModel);
  if (criteriaFilter) {
    modules = filterModules(modules, criteriaFilter);
  }

  const invocation = captureInvocation(projectRoot);

  // Empty file list → empty plan with a friendly message, exit clean.
  if (files.length === 0) {
    const emptyPlan = storage.createPlan(prompt, scope, invocation);
    storage.setMatchedFiles(emptyPlan.plan_id, [], []);
    storage.finalizePlan(emptyPlan.plan_id);
    console.log("");
    console.log(`${DIM}  No files matched the request. Nothing to review.${RESET}`);
    console.log(`${DIM}  Plan ID: ${emptyPlan.plan_id}${RESET}`);
    process.exit(0);
  }

  // Step 3: build the plan (glob match → partition → tasks).
  const partitioner = new ReviewPartitionerService(config, projectRoot);
  const plan = await buildPlanWithTasks(
    storage,
    partitioner,
    prompt,
    scope,
    invocation,
    files,
    modules,
    {
      onMatchingComplete: (criteriaCount, fileCount) => {
        console.log(
          `${DIM}  Matching: ${criteriaCount} criteria matched ${fileCount} file(s)${RESET}`,
        );
        if (criteriaCount > 0) {
          console.log(`${DIM}  Partitioning...${RESET}`);
        }
      },
      onPartitionCompleted: (decision) => {
        const name = decision.review_id.split("/").pop() ?? decision.review_id;
        console.log(
          `${DIM}    ${name}: ${decision.subtasks.length} subtask(s) from ${decision.matched_files.length} file(s)${RESET}`,
        );
      },
    },
  );

  printPlanSummary(plan);

  if (Object.keys(plan.tasks).length === 0) {
    console.log(`${DIM}  No criteria matched the resolved files.${RESET}`);
    process.exit(0);
  }

  // Step 4: execute reviewers. If the orchestrator throws, mark the plan
  // as failed at the reviewing step before re-raising.
  const orchestrator = new ReviewOrchestratorService(config, projectRoot);
  try {
    await executeAndPrint(orchestrator, plan.plan_id, config.concurrency);
  } catch (err) {
    storage.setFailure(plan.plan_id, {
      step: "reviewing",
      review_id: null,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // Step 5: render.
  const finalPlan = storage.getPlan(plan.plan_id);
  const results = storage.getResults(plan.plan_id);
  console.log(renderTerminal(results, finalPlan));
  process.exit(checkFailOn(results, options.failOn));
}

/** `deskcheck watch [plan-id]` */
async function watchCommand(planId?: string): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const storage = new ReviewStorageService(path.join(projectRoot, config.storage_dir));

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

/** `deskcheck test [criterion-name]` */
async function testCommand(
  criterionName: string | undefined,
  options: { criteria?: string },
): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const config = loadConfig(projectRoot);
  const testsDir = path.resolve(projectRoot, config.tests_dir);
  const criteriaDir = path.resolve(projectRoot, config.modules_dir);
  const storageDir = path.join(projectRoot, config.storage_dir, "../test-runs");

  // Parse criteria filter from positional argument or --criteria option
  let criteriaFilter: string[] | undefined;
  if (criterionName) {
    criteriaFilter = [criterionName];
  } else if (options.criteria) {
    criteriaFilter = options.criteria.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  // Discover test cases
  const testCases = discoverTests(testsDir, criteriaDir, criteriaFilter);

  if (testCases.length === 0) {
    console.log("No test cases found.");
    return;
  }

  // Count unique criteria
  const uniqueCriteria = new Set(testCases.map((tc) => tc.criterionId));
  console.log("");
  console.log(`${DIM}  Discovered ${testCases.length} test case${testCases.length !== 1 ? "s" : ""} for ${uniqueCriteria.size} criteria${RESET}`);
  console.log("");

  // Run tests with progress callback
  const runner = new TestRunnerService(config, projectRoot);
  let completed = 0;

  const run = await runner.run(testCases, storageDir, {
    onTestComplete: (criterionId: string, testName: string, result: TestCaseResult) => {
      completed++;
      const isComplete = result.status === "complete";
      const isError = result.status === "error";

      if (isError) {
        console.log(`${RED}  \u2717 ${criterionId}/${testName}${RESET} ${DIM}(error)${RESET}`);
      } else if (isComplete && result.scores) {
        const passing = result.scores.recall >= 0.8 && result.scores.precision >= 0.8 && result.scores.scope_compliance >= 0.8;
        const icon = passing ? `${GREEN}\u2713` : `${YELLOW}\u25B2`;
        const recall = Math.round(result.scores.recall * 100);
        const precision = Math.round(result.scores.precision * 100);
        console.log(`${icon} ${criterionId}/${testName}${RESET} ${DIM}(recall: ${recall}%, precision: ${precision}%)${RESET}`);
      } else {
        console.log(`${DIM}  \u25CB ${criterionId}/${testName} (${result.status})${RESET}`);
      }
    },
  });

  console.log("");

  // Render final detailed results
  console.log(renderTestResults(run));
}

// =============================================================================
// Program
// =============================================================================

const program = new Command();

program
  .name("deskcheck")
  .description("Modular code deskcheck tool powered by Claude")
  .version("0.4.1");

// Default command: natural language deskcheck
program
  .argument("[prompt]", "What to check (natural language)")
  .option("--fail-on <severities>", "Exit non-zero if findings match: critical, warning, info (comma-separated)")
  .option("--criteria <names>", "Only run specific criteria (comma-separated, e.g. dto-enforcement,controller-conventions)")
  .option("--scope <value>", "Override resolver scope inference: 'all', 'changes', or 'changes:<ref>'")
  .action(async (prompt: string | undefined, options: { failOn?: string; criteria?: string; scope?: string }) => {
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
  .option("--criteria <names>", "Only run specific criteria (comma-separated, e.g. dto-enforcement,controller-conventions)")
  .addHelpText("after", `
Examples:
  deskcheck diff                      Check working tree vs HEAD (staged + unstaged)
  deskcheck diff develop              Check changes vs develop branch
  deskcheck diff HEAD~3               Check last 3 commits
  deskcheck diff develop --dry-run    Show plan without executing
  deskcheck diff develop --fail-on=critical  Exit non-zero on critical findings
  deskcheck diff develop --criteria=dto-enforcement  Only run one criterion
  `)
  .action(async (gitArgs: string[], options: { format: string; failOn?: string; dryRun: boolean; concurrency: string; criteria?: string }) => {
    try {
      await diffCommand(gitArgs, {
        ...options,
        concurrency: parseInt(options.concurrency, 10) || 5,
        criteria: options.criteria,
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
  .option("--explain", "Print a detailed reference of all config and criterion options")
  .action((options: { explain?: boolean }) => {
    try {
      if (options.explain) {
        explainConfig();
      } else {
        initCommand();
      }
    } catch (error) {
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

// Subcommand: test
program
  .command("test")
  .description("Run criterion tests against fixture files")
  .argument("[criterion-name]", "Only run tests for this criterion")
  .option("--criteria <names>", "Only run specific criteria (comma-separated)")
  .addHelpText("after", `
Examples:
  deskcheck test                                    Run all criterion tests
  deskcheck test backend/controller-conventions     Run tests for one criterion
  deskcheck test --criteria=dto-enforcement,naming  Run tests for specific criteria
  `)
  .action(async (criterionName: string | undefined, options: { criteria?: string }) => {
    try {
      await testCommand(criterionName, options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();
