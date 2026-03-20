# deskcheck

A modular code deskcheck tool that uses Claude to find architectural and convention violations in your code.

## The Problem

Code review tools fall into three categories, with a gap between them:

- **Tests** verify behavior. They tell you "the order flow produces the right result." They cannot tell you "the order flow uses raw arrays instead of typed DTOs."
- **Static analysis** (ESLint, PHPStan) verifies types and syntax. It tells you "this variable is unused." It cannot tell you "this controller has business logic that belongs in a service."
- **LLM reviewers** can catch architectural violations, but a single agent reviewing an entire branch suffers **context rot** — as its context fills with code, it starts missing the very patterns it's supposed to detect.

## The Solution

This tool breaks every deskcheck into the smallest possible unit: **one file, one set of criteria, one fresh agent**. Each checker gets a clean context with only the code it needs to review and the specific rules it's checking. Results are aggregated mechanically.

```
Your code + Criteria → Planner → N executor agents → Aggregated findings
                                   (fresh context each)
```

### How it Works

1. **You define criteria** — markdown files that describe what to check, which files to check, and how severe violations are.
2. **The tool matches criteria to your files** — using glob patterns in each criterion's frontmatter.
3. **Each match becomes a task** — one file + one criterion = one task.
4. **Each task runs in a fresh agent** — a new Claude instance with only the code and criteria for that one task. No context leakage between tasks.
5. **Findings are aggregated** — grouped by severity, file, and criterion.

This eliminates context rot. A fresh agent with 5K tokens of context (one file + one set of criteria) catches violations with near-100% reliability. A single agent 150K into a review session will miss them.

## Quick Start

```bash
# Install
npm install -g deskcheck

# Initialize in your project
deskcheck init

# Check your branch changes
deskcheck diff develop

# Check a specific file
deskcheck "app/Services/OrderService.php"

# Watch a deskcheck in progress (in another terminal)
deskcheck watch
```

## Criteria

Criteria are markdown files in your `deskcheck/criteria/` directory. Each criterion defines **what to check** and **which files to check**.

```
deskcheck/criteria/
├── architecture/
│   ├── dto-enforcement.md
│   └── separation-of-concerns.md
└── backend/
    └── controller-conventions.md
```

### Criterion Format

Each criterion has YAML frontmatter (metadata) and a markdown body (the instructions given to the executor agent):

```yaml
---
description: "Ensures Data classes are used at architectural layer boundaries"
severity: high
globs:
  - "app/Http/Controllers/**/*.php"
  - "app/Services/**/*.php"
  - "!app/Services/Internal/**/*.php"
mode: "Create one review per changed file"
model: sonnet
---

# DTO Enforcement

You are reviewing code for proper use of Data Transfer Objects at
architectural layer boundaries.

## What to Check

1. Methods that pass raw arrays between layers (controller → service)
2. Use of $request->validated() instead of Data::from($request)
3. Missing Data classes where one should exist

## What NOT to Check

- Simple scalar parameters (string $id, int $count)
- Internal private methods
- Data passed to Eloquent methods

## Severity Guidance

- **critical**: A Data class exists but isn't used
- **warning**: $request->validated() used instead of Data::from
- **info**: New data shape that might benefit from a Data class
```

### Frontmatter Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `description` | Yes | — | Human-readable description shown in reports |
| `severity` | Yes | — | Criterion importance: `critical`, `high`, `medium`, `low` |
| `globs` | Yes | — | File patterns that activate this criterion. Prefix with `!` to exclude |
| `mode` | No | `"Create one review per changed file"` | How to split tasks — natural language instruction |
| `model` | No | `"haiku"` | Which Claude model: `haiku`, `sonnet`, `opus` |

### The Detective Prompt

The markdown body below the frontmatter is the **detective prompt** — the instructions given to each executor agent. It should include:

- **What to Check** — specific patterns, violations, or criteria
- **What NOT to Check** — exclusions to prevent false positives
- **Severity Guidance** — when to report critical vs. warning vs. info

The prompt can reference project files and tell the agent to use tools for navigation (Read, Glob, Grep) to understand context beyond the reviewed file.

## CLI Commands

### `deskcheck diff [git-args...]`

Deterministic check of git changes. No LLM planner — passes args directly to `git diff`. Fast and cheap.

```bash
deskcheck diff develop                    # Changes vs develop
deskcheck diff --staged                   # Staged changes
deskcheck diff HEAD~3                     # Last 3 commits
deskcheck diff main -- app/Services/      # Scoped to directory
deskcheck diff develop --dry-run          # Preview plan without executing
deskcheck diff develop --fail-on=critical # Exit 1 if critical findings (CI)
deskcheck diff develop --format=markdown  # Output as markdown (for PR comments)
```

### `deskcheck "<prompt>"`

Natural language deskcheck — an LLM agent interprets what you want to check.

```bash
deskcheck "app/Services/OrderService.php"           # Full file check
deskcheck "the calculate method in Commission.php"  # Symbol check
deskcheck "check the auth module"                   # Vague — agent figures it out
```

### `deskcheck watch [plan-id]`

Live tree view of a deskcheck in progress. Polls storage every second and reprints.

```bash
# Terminal 1: start a deskcheck
deskcheck diff develop

# Terminal 2: watch it
deskcheck watch
```

Shows a tree with criteria as parents, files as children, status icons (`○` pending, `◐` active, `✓` done, `✗` error), findings counts, and a progress bar.

### `deskcheck show [plan-id]`

Display results from a completed (or in-progress) deskcheck.

```bash
deskcheck show                        # Latest deskcheck
deskcheck show 2026-03-19_143022      # Specific deskcheck
deskcheck show --format=markdown      # Markdown output
deskcheck show --format=json          # JSON output
deskcheck show --fail-on=warning      # Exit 1 if warnings or worse
```

### `deskcheck list`

List all deskcheck runs with their status and finding counts.

### `deskcheck init`

Scaffold `.deskcheck/config.json` and `deskcheck/criteria/` directory.

## Configuration

Configuration lives in `.deskcheck/config.json`:

```json
{
  "modules_dir": "deskcheck/criteria",
  "storage_dir": ".deskcheck/runs",
  "shared": {
    "allowed_tools": ["Read", "Glob", "Grep"],
    "mcp_servers": {}
  },
  "agents": {
    "planner": {
      "model": "haiku"
    },
    "executor": {
      "additional_tools": [],
      "additional_mcp_servers": {}
    },
    "evaluator": {
      "model": "haiku"
    }
  }
}
```

### Agent Permissions

Permissions use a shared base + per-role overrides:

- **`shared.allowed_tools`** — tools available to all agents (default: Read, Glob, Grep)
- **`shared.mcp_servers`** — MCP servers available to all agents
- **`agents.executor.additional_tools`** — extra tools for executor agents only
- **`agents.executor.additional_mcp_servers`** — extra MCP servers for executors (e.g., Serena for code navigation)

Executor **model** is NOT set in config — it comes from each criterion's `model` frontmatter field. This lets cheap checks use `haiku` and deep analysis use `sonnet` or `opus`.

## Storage

Each deskcheck run creates a timestamped directory with two files:

```
.deskcheck/runs/
└── 2026-03-19_143022/
    ├── plan.json       # Tasks, context, coverage — what was checked
    └── results.json    # Findings, aggregations — what was found
```

- **plan.json** contains the full plan: source, tasks (with executor context and prompts), matched/unmatched files, criterion summaries. Can be pruned to save space after the run.
- **results.json** contains findings grouped by severity, file, and criterion. This is the permanent record.

Both files are updated incrementally during execution, enabling live watching via `deskcheck watch`.

## CI Integration

Use `deskcheck diff` with `--fail-on` for CI gating:

```bash
# In your CI pipeline
deskcheck diff $BASE_BRANCH --fail-on=critical --format=markdown > deskcheck.md

# Post as PR comment (example with gh CLI)
gh pr comment $PR_NUMBER --body "$(cat deskcheck.md)"
```

Exit codes:
- `0` — no findings matching the threshold
- `1` — findings exceed the threshold

## MCP Server

The tool also functions as an MCP server for Claude Code integration:

```json
// .mcp.json
{
  "deskcheck": {
    "command": "node",
    "args": ["./node_modules/deskcheck/build/mcp-server.js"]
  }
}
```

This exposes deskcheck tools (start_review_plan, create_review_task, finish_review, etc.) so Claude Code can drive the deskcheck process programmatically.

## Architecture

```
CLI / MCP Server
     │
     ├── agents/
     │   ├── planner.ts        — Agent SDK agent for natural language intent
     │   ├── orchestrator.ts   — Spawns executor agents, collects findings
     │   └── executor-prompt.ts — Builds per-task system prompt
     │
     ├── core/
     │   ├── types.ts          — All TypeScript interfaces
     │   ├── config.ts         — Load .deskcheck/config.json
     │   ├── module-parser.ts  — Parse criterion markdown
     │   ├── glob-matcher.ts   — Match files against criterion globs
     │   ├── storage.ts        — Two-file storage (plan.json + results.json)
     │   ├── plan-builder.ts   — Create plan with tasks from file list
     │   └── context-extractor.ts — Extract diff/file/symbol content
     │
     ├── mcp/
     │   └── tools.ts          — MCP tool registration
     │
     └── renderers/
         ├── terminal.ts       — ANSI-colored terminal output
         ├── watch.ts          — Live tree view for deskcheck watch
         ├── markdown.ts       — Markdown for PR comments
         └── json.ts           — JSON for piping
```

**Key design principle:** `core/` has zero framework dependencies. It's pure TypeScript that handles parsing, matching, and storage. `agents/` depends only on the Agent SDK. `mcp/` depends only on the MCP SDK. `renderers/` depend only on types.

## Writing Criteria

### Start Simple

A minimal criterion:

```yaml
---
description: "Check for console.log statements in production code"
severity: low
globs:
  - "src/**/*.ts"
  - "!src/**/*.test.ts"
model: haiku
---

Check the code for `console.log` statements that should be removed
before merging to production. Ignore logging in test files.
```

### Use the Right Model

| Use case | Model | Cost |
|----------|-------|------|
| Simple pattern checks (naming, imports) | `haiku` | Low |
| Architectural judgment (SoC, DTOs) | `sonnet` | Medium |
| Security analysis, complex data flow | `opus` | High |

### Reference Project Rules

Your detective prompt can tell the executor to read project files:

```markdown
Read `.eslintrc.js` to understand the project's linting rules.
Then check if the reviewed code follows patterns not covered by ESLint.
```

### Glob Patterns

| Pattern | Matches |
|---------|---------|
| `app/**/*.php` | All PHP files under app/ |
| `src/components/**/*.vue` | All Vue components |
| `!**/*.test.ts` | Exclude test files |
| `app/Http/Controllers/**/*.php` | Controllers only |
