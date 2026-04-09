# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is deskcheck

Deskcheck is a modular code review tool powered by the Claude Agent SDK. Users define review criteria as markdown files with YAML frontmatter. Each criterion is matched against files via globs, then a partitioner agent decides how to split the matched files into subtasks, then a fresh reviewer agent runs against each subtask. Findings are aggregated and viewable in terminal, markdown, JSON, or a single-file Vue web dashboard.

## Commands

```bash
# Build (TypeScript → build/)
npm run build

# Watch mode
npm run dev

# Run tests
npm test                  # vitest run
npm run test:watch        # vitest in watch mode

# Build the Vue web UI (separate package in ui/)
cd ui && npm ci && npx vite build

# Seed dev fixtures into .deskcheck/runs/ for UI work (no API calls)
npm run seed             # additive
npm run seed -- --clean  # wipes .deskcheck/runs/ first

# Full prepublish (builds backend + frontend)
npm run prepublishOnly
```

## Pipeline overview

A run flows through four steps. The backend tracks the current step on `plan.step` so the UI can render a live pipeline bar.

```
Invocation
  ├─ diff path:            scope + file list from `git diff <ref> --name-only`
  └─ natural-language path: ReviewInputResolverService agent → { scope, files }
        ↓
Glob matching (programmatic, no LLM): files × criteria → matched pairs
        ↓
Partitioning (one fresh agent per criterion, all in parallel):
        matched files + criterion `partition` instruction → subtasks (with optional `focus` and `hint`)
        ↓ (barrier — all partitioners must finish before any reviewer starts)
Reviewing (one fresh agent per subtask, concurrency pool of 5):
        criterion + assigned files + scope → JSON issue array
```

Every agent run is persisted: full SDK message transcripts go to side-files (`task_<id>.log.json`, `partitioner_<flattened-id>.log.json`) under the plan's run directory. Partitioner reasoning and subtask metadata land in `plan.json`. Issues land in `results.json`.

If anything fails (partitioner crash, validation failure, orchestrator error), the plan is stamped with `step: "failed"`, `status: "failed"`, and a `failure: { step, review_id, message }` blob, then the error propagates so the CLI surfaces it.

## Architecture

### Backend (`src/`, TypeScript, ESM, NodeNext module resolution)

**Entry points**
- `src/cli.ts` — Commander-based CLI. Top-level commands: `diff`, `init`, `list`, `show`, `watch`, `serve`, `test`, plus the default natural-language command (`deskcheck "<prompt>"`).
- `src/mcp-server.ts` — `deskcheck-mcp` binary entry point. Spawns an MCP server over stdio.

**Types**
- `src/types/criteria.ts` — `ReviewModule`, `AgentModel`. The shape of a parsed criterion file.
- `src/types/review.ts` — `ReviewPlan`, `ReviewTask`, `ReviewResults`, `Issue`, `Reference`, `Scope`, `PipelineStep`, `PlanFailure`, `PartitionDecision`, `PartitionedSubtask`, `TaskUsage`. The on-disk and in-memory shapes for plans and results.
- `src/types/testing.ts` — types for the `deskcheck test` (criterion fixture eval) subsystem.

**Config**
- `src/config/types.ts` + `src/config/loader.ts` — `.deskcheck/config.json` shape and loader. Per-role agent config under `agents.{resolver,partitioner,executor,evaluator,judge}`. Built-in tools always available to reviewers regardless of config.

**Criteria**
- `src/services/criteria/module-parser.ts` — `discoverModules()` walks the criteria dir, `parseModule()` reads one file. Frontmatter fields: `description` (required), `globs` (required), `partition` (optional, default `"one task per matched file"`), `model` (optional, default `"haiku"`), `tools` (optional). Body becomes the reviewer's detective prompt.
- `src/services/criteria/glob-matcher.ts` — `findMatchingModules()` matches a file list against module globs. Supports `!exclusion` patterns.

**Review pipeline**
- `src/services/review/ReviewInputResolverService.ts` — natural-language path. Spawns an agent with built-in tools (`Bash`/`Read`/`Glob`/`Grep`) and an in-process MCP `submit_resolution` tool. Returns `{ scope, files }`. Does NOT match criteria, partition, or review.
- `src/services/review/ReviewPlanBuilderService.ts` — `buildPlanWithTasks()`. Creates the plan, glob-matches, transitions `step → partitioning`, runs all partitioners in parallel via `Promise.all`, persists each `PartitionDecision`, materializes tasks via `addTask()`, transitions `step → reviewing`. Stamps `setFailure()` on partitioner errors before rethrowing.
- `src/services/review/ReviewPartitionerService.ts` — one agent per criterion. Built-in tools only (`Read`/`Grep`/`Glob`/`Bash`) plus an in-process MCP `submit_partition` tool. Validates output via `validatePartition()` (every input file must appear in ≥1 subtask; files may overlap if `focus` differs). On invalid output, returns an error to the agent so it can retry within its turn budget. `PartitionerError` carries `reviewId` as a typed property.
- `src/services/review/ReviewOrchestratorService.ts` — async generator. Runs reviewer agents concurrently (pool of 5). Yields `task_started`/`task_completed`/`task_error`/`batch_progress`/`complete` events. Persists each task's full SDK message stream as a side-file via `storage.writeTaskLog()`.
- `src/services/review/ReviewStorageService.ts` — file-based JSON storage with file-locked writes (`withLock` using atomic exclusive create). Plan dir: `<storage_dir>/<plan_id>/`. Files: `plan.json`, `results.json`, `task_<id>.log.json`, `partitioner_<flattened-id>.log.json`. Methods: `createPlan`, `addTask`, `claimTask`, `completeTask`, `errorTask`, `setStep` (auto-promotes status on terminal step), `setFailure`, `setPartitionDecision`, `writeTaskLog`/`getTaskLog`, `writePartitionerLog`/`getPartitionerLog`.
- `src/services/ExecutorService.ts` — single-purpose wrapper around the Agent SDK `query()` for reviewer agents. Merges built-in tools (`BUILTIN_REVIEWER_TOOLS = [Read, Grep, Glob, Bash]`) + config tools + per-criterion `tools` + caller-supplied `extraTools`. Captures the full SDK message stream into `messages: unknown[]` for transcript persistence.
- `src/services/FindingsParserService.ts` — parses reviewer JSON output into `Issue[]`. Each issue must have a `references` array; items without it are skipped. References carry `startLine`/`endLine`/`contextLines` instead of a single `line`. The `code` field is always `null` at parse time — populated downstream.
- `src/services/review/CodeSnippetService.ts` — `resolveCodeSnippets(issues, projectRoot)` — post-processing step that reads files from disk and populates `reference.code` based on `startLine`/`endLine`/`contextLines`. Runs after `parseIssues()` in the orchestrator, before `completeTask()`. Caches file reads across references. The `code` blob contains the flagged lines plus surrounding context lines; the UI slices it apart using the line range metadata for before/flagged/after rendering.

**Prompts**
- `src/prompts/ResolverPrompt.ts` — system prompt for the input resolver.
- `src/prompts/PartitionerPrompt.ts` — system prompt for partitioner agents. Embeds the criterion's `partition` instruction, file list, and scope.
- `src/prompts/ExecutorPrompt.ts` — system prompt for reviewer agents. Includes "CRITICAL CONSTRAINT" preamble (only check what the criterion asks), the criterion body, assigned files, optional focus, optional grouping hint, scope-aware "fetch your own context" instructions, and JSON output schema.
- `src/prompts/JudgePrompt.ts` — for the `deskcheck test` subsystem (out of scope for the main pipeline).

**MCP server**
- `src/mcp/tools.ts` — registers tools on the `deskcheck-mcp` server: `review_status`, `start_review_plan` (takes `scope_type`/`scope_ref`), `get_review_files_matching_paths`, `create_review_task`, `finish_planning`, `get_pending_review_tasks`, `start_review` (claims a task and returns its scope/files for the caller to fetch context themselves), `finish_review`, `get_review_results`. The MCP server is a parallel surface; it does NOT go through the plan-builder so it doesn't get partitioner agents or `step` transitions.

**HTTP server**
- `src/server/server.ts` — vanilla Node HTTP server. Routes:
  - `GET /` — serves the bundled `ui/dist/index.html`.
  - `GET /api/runs` — list of runs (with `step`, `failure`, scope, summary).
  - `GET /api/runs/:id` — **merged** plan + results in one response. Used by the new UI.
  - `GET /api/runs/:id/plan`, `/results` — separate endpoints, kept for backward compatibility.
  - `GET /api/runs/:id/tasks/:taskId/log` — reviewer transcript side-file.
  - `GET /api/runs/:id/partitioners/:reviewId/log` — partitioner transcript side-file.
  - `GET /api/events/:id` — SSE that emits `{"type":"update"}` whenever `plan.json`/`results.json` changes on disk. Untyped — clients refetch on each notification.
- `src/server/controllers/ReviewController.ts` — request handlers.
- `src/server/sse/FileWatcherSSE.ts` — `fs.watch`-based notifier with polling fallback.
- `src/server/middleware/cors.ts` — CORS preflight.

**Renderers** (`src/renderers/review/`)
- `TerminalRenderer.ts`, `MarkdownRenderer.ts`, `JsonRenderer.ts`, `WatchRenderer.ts`. Watch renderer shows live partition decisions and per-subtask `[focus]` annotations.

**Testing subsystem** (`src/services/testing/`, `src/renderers/test/`, `src/types/testing.ts`)
- Independent of the main review pipeline. Runs criteria against fixture files, scores precision/recall against expected findings via an LLM judge. Out of scope for most refactors — only touch when changing `deskcheck test`.

### Frontend (`ui/`, Vue 3 + Vite)

Separate npm package built as a single-file HTML via `vite-plugin-singlefile`. Served by the backend at `GET /`. Dark theme only. System fonts only — no external font loads.

**Routes** (`ui/src/router.ts`, hash history)
- `/` → `V0RunList` — table of all runs, polls `/api/runs` every 5s.
- `/runs/:planId` → `V1Overview` — pipeline bar, run metadata, stat cards (live elapsed), criteria→subtasks accordion, issues table with severity + criterion filters.
- `/runs/:planId/criteria/:criterionId` → `V2Criterion` — criterion metadata (incl. partition string), partitioner reasoning block, subtask list, scoped issues table.
- `/runs/:planId/tasks/:taskId` → `V3Subtask` — subtask metadata, assigned files, stat cards, issue cards with code-block before/after.

**State** (`ui/src/composables/`)
- `useRun(planId)` — single-source-of-truth for one run. Loads `/api/runs/:id`, exposes reactive `plan`/`results`/`loading`/`error` plus computed derivations: `pipelineState`, `criterionRows` (per-criterion rollup with subtasks/totals/status), `tokenBreakdown` (partition vs review), `allIssues`. Lookups: `criterionRow`, `subtaskRow`, `issuesForTask`, `issuesForCriterion`. Plus `useElapsed(startedAt, endedAt)` for live-ticking durations.
- `useRunSse(planId, run)` — wires `useSse` to a `useRun` instance. Refetches on every SSE notification.
- `useSse(url, onMessage)` — tiny `EventSource` wrapper.

**API client** (`ui/src/api.ts`)
- `listRuns()`, `getRun(planId)`, dormant `getTaskLog`/`getPartitionerLog`. Defensive: throws on parse error so callers can skip the tick.

**Types** (`ui/src/types.ts`)
- Hand-mirrored from `src/types/review.ts`/`criteria.ts`. **Update both when either changes.**

**Components** (`ui/src/components/`)
- Shared: `Badge`, `SeverityBadge`, `StatusBadge`, `ScopeBadge`, `StatusDot` (solid dot for terminal states; spinning ring for `in_progress`), `Stat`, `FilterChips` (single + multi via generic), `Meta` (with named slot escape hatch), `Crumb`, `Pipeline` (4-cell bar with spinner on active step, failed red), `Collapse`, `Header`.
- Used by views: `IssuesTable` (toggleable criterion column), `SubtaskRowItem` ("first-file +N more" naming).

**Styles** (`ui/src/styles/tokens.css`)
- All design tokens as CSS custom properties on `:root`. Single file. No SCSS/PostCSS.

## Storage shapes

### `plan.json`

```ts
{
  plan_id: "2026-04-08_143022",            // timestamp-based, also the dir name
  name: "diff: main",
  invocation: { command, args[], cwd },    // reproducibility
  scope: { type: "all" } | { type: "changes", ref: "main" },
  status: "planning" | "ready" | "executing" | "complete" | "failed",
  step: "matching" | "partitioning" | "reviewing" | "complete" | "failed",
  failure: null | { step, review_id, message },
  matched_files: string[],                  // intersected against criterion globs
  unmatched_files: string[],                // coverage gaps
  tasks: Record<task_id, ReviewTask>,       // includes scope, focus, hint, model, tools, error, prompt
  modules: Record<review_id, ModuleSummary>,// includes partition string (post stage 9 cleanup)
  partition_decisions: Record<review_id, PartitionDecision>,
  // ... timestamps
}
```

### `results.json`

```ts
{
  plan_id, status, updated_at,
  completion: { total, completed, pending, in_progress, errored },
  summary: { total, critical, warning, info },
  task_results: Record<task_id, TaskResult>,   // issues + usage
  by_file: Record<filepath, FileIssue[]>,      // an issue can appear under multiple files via references
  by_module: Record<review_id, ModuleIssues>,
  total_usage: TotalUsage,
}
```

### Side-files

- `task_<task_id>.log.json` — full SDK message stream from the reviewer agent.
- `partitioner_<flattened-review-id>.log.json` — same for the partitioner agent. `/` in review_id is flattened to `--`.

## Key patterns

- **Agent SDK** integration uses `query()` from `@anthropic-ai/claude-agent-sdk` for resolver, partitioner, and reviewer agents. Each agent run is fresh — no shared session.
- **Per-criterion model**: `model` from frontmatter sets the reviewer model, copied through `ReviewTask.model`. Partitioner uses `config.agents.partitioner.model`. Resolver uses `config.agents.resolver.model`.
- **Per-criterion tools**: optional `tools: [...]` in frontmatter layers extra tools on top of built-ins for reviewers running that criterion. Partitioners get built-ins only.
- **Built-in reviewer tools**: `Read`, `Grep`, `Glob`, `Bash` always available regardless of config. Hard-wired in `ExecutorService.BUILTIN_REVIEWER_TOOLS`.
- **In-process MCP servers**: resolver and partitioner each create their own via `createSdkMcpServer`, exposing exactly one tool each (`submit_resolution` and `submit_partition`).
- **Reviewers fetch their own context**: the reviewer prompt does NOT inline file content. It tells the reviewer to run `git diff <ref> -- <file>` (changes scope) or `Read` the file (all scope) using built-in tools.
- **Storage is file-based JSON** under `.deskcheck/runs/`. No database. Atomic writes via temp+rename. Cross-process locking via exclusive-create lock files.
- **Cross-process SSE** uses file watching, not in-memory eventbus. The CLI process and the `deskcheck serve` process communicate only through the filesystem.
- **TypeScript** compiles to `build/` with `Node16` module resolution. ESM throughout. `.js` extensions in import specifiers (NodeNext requirement).

## Demo and dev fixtures

- **`scripts/seed-fixtures.ts`** (`npm run seed`) — writes 5 synthetic plans to `.deskcheck/runs/` exercising every UI state (complete, in-progress, failed, clean, empty). Use for UI development without spending tokens.
- **`examples/demo-project/`** — a small TypeScript project with deliberately planted issues and three criteria targeting them. Run a real review with `cd examples/demo-project && deskcheck "review src/"`. Costs ~5–15¢ in haiku tokens. **Initialize a git repo inside the demo dir first** (`git init && git add -A && git commit -m init`) to keep `deskcheck diff` from inheriting the parent repo's state.

## Things to avoid when modifying

- Don't add files to `task.context` / `task.context_type` / `task.symbol` / `plan.source` / `plan.source.target` — those fields no longer exist. Reviewers fetch their own context.
- Don't add a criterion-level `severity` field — it was removed. Only per-issue `severity` exists.
- Don't use `mode` for the partition instruction — it was renamed to `partition`.
- Don't try to extract the partitioner's failed criterion id from the error message string — `PartitionerError` carries `reviewId` as a typed property.
- Don't call `extractContext` or import `ReviewContextExtractorService` — both removed.
- Don't reference `agents.planner` in config — renamed to `agents.resolver`.
- Don't add a `line` field to `Reference` — it was replaced by `startLine`/`endLine`/`contextLines`. Don't populate `reference.code` in the parser or executor prompt — it's always `null` at parse time and filled by `CodeSnippetService.resolveCodeSnippets()` after parsing, before writing results.
- The `deskcheck test` subsystem has its own pipeline (`TestRunnerService`, `JudgeService`) and its own types (`src/types/testing.ts`). Don't conflate it with the review pipeline.
- The Vue UI in `ui/` is a separate npm package. Run its build from inside `ui/`. Its `tsconfig.json` has a known broken project-references setup that doesn't affect the vite build but does break direct `vue-tsc -p tsconfig.json` invocations — known issue, not from any recent change.
