import fs from "node:fs";
import path from "node:path";
import type http from "node:http";

/**
 * Stream SSE events when JSON files change in a watched directory.
 *
 * Watches the given directory for changes to `.json` files and emits
 * `data: {"type":"update"}` events to the connected client. Falls back
 * to polling if `fs.watch` is unavailable.
 */
export function handleSSE(
  res: http.ServerResponse,
  storageDir: string,
  planId: string,
): void {
  const planDir = path.join(storageDir, planId);

  if (!fs.existsSync(planDir)) {
    const body = JSON.stringify({ error: `Plan not found: ${planId}` });
    res.writeHead(404, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    res.end(body);
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
