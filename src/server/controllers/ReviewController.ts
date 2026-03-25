import type http from "node:http";
import type { ReviewStorageService } from "../../services/review/ReviewStorageService.js";
import type { ReviewResults } from "../../types/review.js";

// =============================================================================
// Types
// =============================================================================

/** A run summary returned by GET /api/runs. */
export interface RunSummary {
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
// Response helpers (used by controller handlers)
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

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, { error: message }, status);
}

// =============================================================================
// Route handlers
// =============================================================================

export function handleGetRuns(storage: ReviewStorageService, res: http.ServerResponse): void {
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

export function handleGetPlan(storage: ReviewStorageService, res: http.ServerResponse, planId: string): void {
  try {
    const plan = storage.getPlan(planId);
    sendJson(res, plan);
  } catch {
    sendError(res, 404, `Plan not found: ${planId}`);
  }
}

export function handleGetResults(storage: ReviewStorageService, res: http.ServerResponse, planId: string): void {
  try {
    const results = storage.getResults(planId);
    sendJson(res, results);
  } catch {
    sendError(res, 404, `Results not found for plan: ${planId}`);
  }
}
