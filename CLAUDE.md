# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is deskcheck

Deskcheck is a modular code review tool powered by the Claude Agent SDK. Users define review criteria as markdown files with YAML frontmatter. Each criterion is matched against files via globs, and each (file, criterion) pair runs in a fresh Claude agent with clean context. Findings are aggregated and viewable in terminal, markdown, JSON, or a web dashboard.

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

# Full prepublish (builds backend + frontend)
npm run prepublishOnly
```

## Architecture

**Backend (src/, TypeScript, ESM)**

- `src/cli.ts` — CLI entry point using Commander. Commands: `diff`, `init`, `list`, `show`, `watch`, `serve`, and default natural-language prompt mode.
- `src/agents/planner.ts` — `ReviewPlanner` spawns a Claude agent (via Agent SDK `query()`) with an in-process MCP server to interpret natural language input and create review plans.
- `src/agents/orchestrator.ts` — `ReviewOrchestrator` executes plans by running executor agents concurrently (pool of up to 5). Uses an async generator to yield progress events. Each executor gets a system prompt built from the task's criterion + file context.
- `src/agents/executor-prompt.ts` — Builds the system prompt for executor agents from task data.
- `src/core/types.ts` — All shared TypeScript types (ReviewPlan, ReviewTask, ReviewConfig, Finding, etc.).
- `src/core/config.ts` — Loads `.deskcheck/config.json`, deep-merges with defaults.
- `src/core/module-parser.ts` — Discovers and parses criterion markdown files (frontmatter + body).
- `src/core/plan-builder.ts` — Matches files to criteria via globs and creates plan + tasks.
- `src/core/storage.ts` — File-based storage for plans (`plan.json`) and results (`results.json`) under `.deskcheck/runs/<plan-id>/`.
- `src/core/context-extractor.ts` — Extracts file content or git diff for executor context.
- `src/core/glob-matcher.ts` — Matches file paths against criterion glob patterns.
- `src/serve.ts` — Vanilla Node.js HTTP server serving the Vue SPA, JSON API (`/api/runs`, `/api/runs/:id/plan`, `/api/runs/:id/results`), and SSE (`/api/events/:id`) for live updates.
- `src/mcp-server.ts` — MCP server entry point (`deskcheck-mcp` binary) exposing review tools over stdio.
- `src/mcp/tools.ts` — MCP tool definitions registered on the server.
- `src/renderers/` — Output formatters: terminal, markdown, json, watch (live tree view).

**Frontend (ui/, Vue 3 + Vite)**

Separate package with its own `package.json`. Built as a single-file HTML (`vite-plugin-singlefile`) served by the backend. Pages: Dashboard and RunDetail. Uses SSE composable for live updates.

**Key patterns:**
- Agent SDK integration uses `query()` from `@anthropic-ai/claude-agent-sdk` — both planner and orchestrator.
- Executor model is per-criterion (from frontmatter `model` field), not global config.
- The planner agent gets an in-process MCP server (via `createSdkMcpServer`) with a `create_plan` tool.
- Storage is file-based JSON under `.deskcheck/runs/`. No database.
- TypeScript compiles to `build/` with `Node16` module resolution. The project uses ESM (`.js` extensions in imports).
