import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { ReviewStorage } from "./core/storage.js";
import type { ReviewConfig, ReviewResults } from "./core/types.js";

// =============================================================================
// Types
// =============================================================================

/** A run summary returned by GET /api/runs. */
interface RunSummary {
  planId: string;
  name: string;
  status: string;
  createdAt: string;
  sourceType: string | null;
  sourceTarget: string | null;
  taskCount: number;
  moduleCount: number;
  moduleNames: string[];
  matchedFiles: number;
  unmatchedFiles: number;
  summary: ReviewResults["summary"] | null;
  completion: ReviewResults["completion"] | null;
}

// =============================================================================
// Response helpers
// =============================================================================

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(html);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, { error: message }, status);
}

// =============================================================================
// Route handlers
// =============================================================================

function handleGetRuns(storage: ReviewStorage, res: http.ServerResponse): void {
  const plans = storage.listPlans();
  const runs: RunSummary[] = plans.map((planSummary) => {
    let summary: ReviewResults["summary"] | null = null;
    let completion: ReviewResults["completion"] | null = null;

    // Enrich with results data if available
    try {
      const results = storage.getResults(planSummary.planId);
      summary = results.summary;
      completion = results.completion;
    } catch {
      // No results file yet
    }

    // Enrich with plan data (tasks, modules, coverage)
    let taskCount = 0;
    let moduleCount = 0;
    let moduleNames: string[] = [];
    let matchedFiles = 0;
    let unmatchedFiles = 0;
    let sourceType: string | null = null;
    let sourceTarget: string | null = null;

    try {
      const plan = storage.getPlan(planSummary.planId);
      taskCount = Object.keys(plan.tasks).length;
      moduleCount = Object.keys(plan.modules).length;
      moduleNames = Object.keys(plan.modules).map((id) => id.split("/").pop() ?? id);
      matchedFiles = plan.matched_files?.length ?? 0;
      unmatchedFiles = plan.unmatched_files?.length ?? 0;
      sourceType = plan.source?.type ?? null;
      sourceTarget = plan.source?.target ?? null;
    } catch {
      // Plan read error
    }

    return {
      planId: planSummary.planId,
      name: planSummary.name,
      status: planSummary.status,
      createdAt: planSummary.createdAt,
      sourceType,
      sourceTarget,
      taskCount,
      moduleCount,
      moduleNames,
      matchedFiles,
      unmatchedFiles,
      summary,
      completion,
    };
  });
  sendJson(res, runs);
}

function handleGetPlan(storage: ReviewStorage, res: http.ServerResponse, planId: string): void {
  try {
    const plan = storage.getPlan(planId);
    sendJson(res, plan);
  } catch {
    sendError(res, 404, `Plan not found: ${planId}`);
  }
}

function handleGetResults(storage: ReviewStorage, res: http.ServerResponse, planId: string): void {
  try {
    const results = storage.getResults(planId);
    sendJson(res, results);
  } catch {
    sendError(res, 404, `Results not found for plan: ${planId}`);
  }
}

function handleSSE(
  res: http.ServerResponse,
  storageDir: string,
  planId: string,
): void {
  const planDir = path.join(storageDir, planId);

  if (!fs.existsSync(planDir)) {
    sendError(res, 404, `Plan not found: ${planId}`);
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Send initial keepalive
  res.write(": connected\n\n");

  // Watch the plan directory for changes to plan.json or results.json
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher | null = null;

  try {
    watcher = fs.watch(planDir, (_eventType, filename) => {
      if (filename !== "plan.json" && filename !== "results.json") return;

      // Debounce: plan.json and results.json often update in quick succession
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          res.write('data: {"type":"update"}\n\n');
        } catch {
          // Client disconnected
          cleanup();
        }
      }, 100);
    });
  } catch {
    // If fs.watch fails, fall back to polling
    const pollInterval = setInterval(() => {
      try {
        res.write('data: {"type":"update"}\n\n');
      } catch {
        clearInterval(pollInterval);
      }
    }, 2000);

    res.on("close", () => {
      clearInterval(pollInterval);
    });
    return;
  }

  function cleanup(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  }

  // Keep-alive every 30s to prevent proxy timeouts
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      cleanup();
      clearInterval(keepalive);
    }
  }, 30_000);

  res.on("close", () => {
    cleanup();
    clearInterval(keepalive);
  });
}

// =============================================================================
// URL parsing
// =============================================================================

/** Parse a URL path into segments, e.g. "/api/runs/abc/plan" -> ["api", "runs", "abc", "plan"]. */
function parseSegments(pathname: string): string[] {
  return pathname.split("/").filter((s) => s.length > 0);
}

// =============================================================================
// Server
// =============================================================================

/**
 * Start the deskcheck web UI server.
 *
 * Serves a self-contained HTML dashboard at the root, a JSON API for run data,
 * and SSE streams for live updates during execution.
 */
export function startServer(config: ReviewConfig, projectRoot: string, port: number): void {
  const storageDir = path.join(projectRoot, config.storage_dir);
  const storage = new ReviewStorage(storageDir);
  const uiHtmlPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../ui/dist/index.html",
  );
  const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendError(res, 405, "Method not allowed");
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
    const segments = parseSegments(parsedUrl.pathname);

    // GET / -> dashboard HTML (re-read on each request so UI rebuilds are picked up without restart)
    if (segments.length === 0) {
      const dashboardHtml = fs.readFileSync(uiHtmlPath, "utf-8");
      sendHtml(res, dashboardHtml);
      return;
    }

    // API routes all start with "api"
    if (segments[0] !== "api") {
      sendError(res, 404, "Not found");
      return;
    }

    // GET /api/runs
    if (segments.length === 2 && segments[1] === "runs") {
      handleGetRuns(storage, res);
      return;
    }

    // GET /api/runs/:id/plan
    if (segments.length === 4 && segments[1] === "runs" && segments[3] === "plan") {
      handleGetPlan(storage, res, decodeURIComponent(segments[2]));
      return;
    }

    // GET /api/runs/:id/results
    if (segments.length === 4 && segments[1] === "runs" && segments[3] === "results") {
      handleGetResults(storage, res, decodeURIComponent(segments[2]));
      return;
    }

    // GET /api/events/:id -> SSE stream
    if (segments.length === 3 && segments[1] === "events") {
      handleSSE(res, storageDir, decodeURIComponent(segments[2]));
      return;
    }

    sendError(res, 404, "Not found");
  });

  server.listen(port, () => {
    console.log(`Deskcheck UI: http://localhost:${port}`);
  });
}
