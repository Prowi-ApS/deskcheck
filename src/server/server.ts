import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { ReviewStorageService } from "../services/review/ReviewStorageService.js";
import { handleCors } from "./middleware/cors.js";
import {
  handleGetRuns,
  handleGetRun,
  handleGetPlan,
  handleGetResults,
  handleGetTaskLog,
  handleGetPartitionerLog,
} from "./controllers/ReviewController.js";
import { handleSSE } from "./sse/FileWatcherSSE.js";
import type { ReviewConfig } from "../config/types.js";

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
  const storage = new ReviewStorageService(storageDir);
  const uiHtmlPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../ui/dist/index.html",
  );
  const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (handleCors(req, res)) return;

    if (req.method !== "GET") {
      sendError(res, 405, "Method not allowed");
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
    const segments = parseSegments(parsedUrl.pathname);

    // GET / -> dashboard HTML (re-read on each request so UI rebuilds are picked up without restart)
    if (segments.length === 0) {
      if (!fs.existsSync(uiHtmlPath)) {
        sendHtml(res, "<html><body><p>UI not built yet. Run <code>cd ui &amp;&amp; npm run build</code>, or use the Vite dev server at <code>http://localhost:5173</code>.</p></body></html>");
        return;
      }
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

    // GET /api/runs/:id -> merged plan + results (used by the new UI)
    if (segments.length === 3 && segments[1] === "runs") {
      handleGetRun(storage, res, decodeURIComponent(segments[2]));
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

    // GET /api/runs/:id/tasks/:taskId/log -> reviewer's full SDK transcript
    if (
      segments.length === 6 &&
      segments[1] === "runs" &&
      segments[3] === "tasks" &&
      segments[5] === "log"
    ) {
      handleGetTaskLog(
        storage,
        res,
        decodeURIComponent(segments[2]!),
        decodeURIComponent(segments[4]!),
      );
      return;
    }

    // GET /api/runs/:id/partitioners/:reviewId/log -> partitioner's full SDK transcript
    if (
      segments.length === 6 &&
      segments[1] === "runs" &&
      segments[3] === "partitioners" &&
      segments[5] === "log"
    ) {
      handleGetPartitionerLog(
        storage,
        res,
        decodeURIComponent(segments[2]!),
        decodeURIComponent(segments[4]!),
      );
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
