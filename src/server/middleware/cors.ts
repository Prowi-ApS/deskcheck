import type http from "node:http";

/**
 * Handle CORS preflight (OPTIONS) requests.
 *
 * Returns `true` if the request was an OPTIONS preflight and has been
 * fully handled (caller should stop processing). Returns `false` otherwise.
 */
export function handleCors(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method !== "OPTIONS") return false;

  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
  return true;
}
