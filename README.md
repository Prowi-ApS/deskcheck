# deskcheck

Modular code review powered by Claude. Define what to check as markdown, deskcheck runs each check in a fresh AI agent, and aggregates the findings.

## Why deskcheck?

Traditional code review tools leave a gap:

- **Tests** verify behavior — they can't tell you "this controller has business logic that belongs in a service"
- **Linters** verify syntax — they can't tell you "this endpoint is missing input validation"
- **A single LLM** reviewing a whole branch suffers **context rot** — as its context fills up, it starts missing the patterns it's supposed to catch

Deskcheck solves this by breaking every review into the smallest possible unit. A **partitioner agent** reads your criterion and decides how to split the matched files into focused subtasks. Each subtask runs in a **fresh reviewer agent** with clean context — only the code it needs and the specific rules to check. Results are aggregated mechanically.

```
Your code + Criteria → Partitioner → N reviewer agents → Aggregated findings
                       (per-criterion)  (fresh context each)
```

## Quick Start

```bash
# Install
npm install -g @prowi/deskcheck

# Initialize in your project (creates criteria directory + config)
deskcheck init

# Review your branch changes against main
deskcheck diff main

# Review with natural language
deskcheck "review src/services/"

# Open the web dashboard
deskcheck serve
```

## How It Works

### 1. You define criteria as markdown

Each criterion is a markdown file with YAML frontmatter that says **what to check**, **which files to check**, and **how to partition the work**:

```yaml
---
description: "Checks for common security vulnerabilities"
globs:
  - "src/**/*.ts"
  - "!src/**/*.test.ts"
partition: one task per file
model: sonnet
---

You are a security reviewer. Check for:

1. **Hardcoded secrets** — API keys, passwords, tokens in source code
2. **SQL injection** — string concatenation in database queries
3. **Missing input validation** — user input used without sanitization

For each issue, report the severity, file, line range, and a fix suggestion.
```

Put criteria in `deskcheck/criteria/` — organize them however you like:

```
deskcheck/criteria/
├── security/
│   └── input-validation.md
├── architecture/
│   └── separation-of-concerns.md
└── best-practices/
    └── error-handling.md
```

### 2. The pipeline runs in four steps

```
Matching → Partitioning → Reviewing → Complete
```

1. **Matching** — files from `git diff` (or a natural-language file list) are matched against each criterion's glob patterns. Programmatic, no LLM.
2. **Partitioning** — for each matched criterion, a fresh agent reads the `partition` instruction and splits the matched files into focused subtasks. The partitioner can inspect files with Read/Grep/Glob to make informed decisions (e.g. "one method per task" requires reading the file to list methods).
3. **Reviewing** — each subtask runs in a fresh reviewer agent with only the criterion instructions, the assigned files, and the scope. Reviewers fetch their own context from disk (diffs for change-mode, full files for all-mode). Up to 5 run concurrently.
4. **Complete** — issues are aggregated by file, criterion, and severity.

### 3. Findings are aggregated

Results are grouped and viewable in the terminal, as markdown (for PR comments), as JSON (for tooling), or in the **web dashboard** (`deskcheck serve`). The dashboard shows a four-step pipeline bar, per-criterion subtask breakdowns, partitioner reasoning, and issue cards with code snippets and suggested fixes.

## CLI Commands

### `deskcheck diff [git-args...]`

Deterministic review of git changes. No LLM resolver — scope and file list are derived directly from `git diff`.

```bash
deskcheck diff                          # Working tree vs HEAD (staged + unstaged)
deskcheck diff main                     # Changes vs main
deskcheck diff HEAD~3                   # Last 3 commits
deskcheck diff main --dry-run           # Preview plan (runs partitioners) without executing reviewers
deskcheck diff main --fail-on=critical  # Exit 1 if critical findings (for CI)
deskcheck diff main --format=markdown   # Markdown output (for PR comments)
deskcheck diff main --criteria=security # Only run one criterion
```

### `deskcheck "<prompt>"`

Natural-language review — a resolver agent interprets what you want to check and produces a `{ scope, files }` pair, then the same downstream pipeline runs.

```bash
deskcheck "review src/services/"
deskcheck "check the auth module"
deskcheck "review changes against develop"
deskcheck "review src/" --scope changes:main     # Override resolver's scope inference
deskcheck "review src/" --criteria=security       # Only run specific criteria
```

### `deskcheck serve`

Web dashboard with live updates via SSE. Four views: run list, review overview (pipeline + criteria + issues), criterion detail (partitioner reasoning + subtask list), and subtask detail (issue cards with code).

```bash
deskcheck serve              # Start on default port (3000)
deskcheck serve --port 8080  # Custom port
```

### `deskcheck show [plan-id]`

Display results in the terminal.

```bash
deskcheck show                        # Latest run
deskcheck show --format=markdown      # As markdown
deskcheck show --format=json          # As JSON
deskcheck show --fail-on=warning      # Exit 1 if warnings or worse
```

### `deskcheck watch [plan-id]`

Live terminal tree view of a run in progress. Shows partition decisions and per-subtask `[focus]` annotations.

### `deskcheck list`

List all runs with status and finding counts.

### `deskcheck test [criterion-name]`

Run criteria against test fixtures to verify they produce correct findings.

```bash
deskcheck test                                    # Run all criterion tests
deskcheck test controller-conventions             # Run tests for one criterion
deskcheck test --criteria=dto-enforcement,naming  # Run tests for specific criteria
```

### `deskcheck init`

Scaffold config and criteria directory for a new project.

## Criterion Reference

### Frontmatter Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `description` | Yes | — | Human-readable description shown in reports |
| `globs` | Yes | — | File patterns to match. Prefix with `!` to exclude |
| `partition` | No | `"one task per matched file"` | Natural-language instruction for how the partitioner agent should split matched files into subtasks |
| `model` | No | `"haiku"` | Claude model for reviewer agents: `haiku`, `sonnet`, `opus` |
| `tools` | No | `[]` | Extra tools available to reviewers for this criterion (e.g. `["WebFetch"]`), layered on top of built-ins |

### Choosing the Right Model

**The model is the most important decision in a criterion.** Wrong model choice produces either false positives (freelancing) or false negatives (overcorrection).

| Use Case | Model | Why |
|----------|-------|-----|
| Purely mechanical pattern matching ("does X exist?") | `haiku` | Fast and cheap — but can't handle exclusion rules |
| **Most criteria** — judgment required, has "What NOT to Check" | **`sonnet`** | **Use this by default.** Good reasoning, follows complex instructions |
| Complex multi-step reasoning, cross-file analysis | `opus` | Deep analysis for architectural assessment |

**If your criterion has a "What NOT to Check" section, do NOT use haiku.** In testing, haiku with exclusion rules either freelanced wildly (8/9 false positives) or overcorrected to zero findings. Sonnet produced 15/15 legitimate findings on the same criterion.

### The Detective Prompt

The markdown body below the frontmatter is the **detective prompt** — instructions given to each reviewer agent. Include:

- **What to check** — specific patterns and violations
- **What NOT to check** — exclusions to reduce false positives
- **Severity guidance** — when to report critical vs warning vs info

Reviewers have built-in tools (Read, Grep, Glob, Bash) and fetch their own context based on the scope, so your prompt can reference other files:

```markdown
Read `.eslintrc.js` to understand the project's linting config.
Then check for architectural patterns that ESLint can't catch.
```

### Partition Instruction

The `partition` field tells the partitioner agent how to split matched files into subtasks. Examples:

```yaml
partition: one task per file               # Simple, default-like
partition: one public method per task       # Sub-file: same file appears in multiple subtasks with different focus
partition: group each test with its source  # Cross-file grouping
partition: bundle all controllers together  # Single grouped review
```

The partitioner agent reads this instruction, inspects the matched files using its tools, and produces subtasks with `files`, optional `focus` (sub-file narrowing), and optional `hint` (reasoning for the grouping).

## Configuration

Configuration lives in `.deskcheck/config.json` (created by `deskcheck init`):

```json
{
  "modules_dir": "deskcheck/criteria",
  "storage_dir": ".deskcheck/runs",
  "tests_dir": "deskcheck/tests",
  "shared": {
    "allowed_tools": ["Read", "Glob", "Grep"],
    "mcp_servers": {}
  },
  "agents": {
    "resolver": { "model": "haiku" },
    "partitioner": { "model": "haiku" },
    "executor": {},
    "evaluator": { "model": "haiku" },
    "judge": { "model": "opus" }
  }
}
```

- **Built-in reviewer tools** (`Read`, `Grep`, `Glob`, `Bash`) are always available regardless of `shared.allowed_tools`. The config tools layer on top.
- The **reviewer model** comes from each criterion's `model` field, not from config.
- The **partitioner model** comes from `agents.partitioner.model` (shared across all criteria).
- The **resolver model** (for natural-language `deskcheck "<prompt>"`) comes from `agents.resolver.model`.

## CI Integration

Use `--fail-on` to gate your pipeline:

```bash
# Fail if any critical findings
deskcheck diff $BASE_BRANCH --fail-on=critical

# Output as markdown for PR comments
deskcheck diff $BASE_BRANCH --format=markdown > review.md
gh pr comment $PR_NUMBER --body "$(cat review.md)"
```

Exit codes: `0` = no findings matching threshold, `1` = findings exceed threshold.

## MCP Server

Deskcheck can run as an MCP server for Claude Code integration:

```json
{
  "mcpServers": {
    "deskcheck": {
      "command": "npx",
      "args": ["deskcheck-mcp"]
    }
  }
}
```

## Demo & Development

### Seed fixtures for UI work (free, no API calls)

```bash
npm run seed -- --clean     # Write 5 synthetic plans exercising every UI state
deskcheck serve             # http://localhost:3000
```

### Run a real review against the demo project (~5–15¢)

```bash
cd examples/demo-project
git init -q && git add -A && git commit -qm init   # one-time setup
deskcheck "review src/"                              # runs resolver + partitioners + reviewers
```

See [`examples/demo-project/README.md`](examples/demo-project/README.md) for the planted issues and expected findings.

### Development setup

The fastest way to get started is with the included **Dev Container** (VS Code + Docker):

1. Open the repo in VS Code
2. When prompted, click **"Reopen in Container"**
3. Press **Ctrl+Shift+B** to launch the dev environment

This starts backend server (port 3000), TypeScript watch, and Vite dev server (port 5173).

Without Dev Container:

```bash
# Terminal 1: backend
npm run build && node build/cli.js serve

# Terminal 2: TypeScript watch
npm run dev

# Terminal 3: UI with hot reload
cd ui && npm install && npm run dev
```

## License

MIT
