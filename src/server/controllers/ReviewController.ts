import type http from "node:http";
import type { ReviewStorageService } from "../../services/review/ReviewStorageService.js";
import type {
  PipelineStep,
  PlanFailure,
  ReviewResults,
  Scope,
} from "../../types/review.js";

// =============================================================================
// Types
// =============================================================================

/** A run summary returned by GET /api/runs. */
export interface RunSummary {
  planId: string;
  name: string;
  status: string;
  createdAt: string;
  scope: Scope | null;
  step: PipelineStep | null;
  failure: PlanFailure | null;
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
    let scope: Scope | null = null;
    let step: PipelineStep | null = null;
    let failure: PlanFailure | null = null;

    try {
      const plan = storage.getPlan(planSummary.planId);
      taskCount = Object.keys(plan.tasks).length;
      moduleCount = Object.keys(plan.modules).length;
      moduleNames = Object.keys(plan.modules).map((id) => id.split("/").pop() ?? id);
      matchedFiles = plan.matched_files?.length ?? 0;
      unmatchedFiles = plan.unmatched_files?.length ?? 0;
      scope = plan.scope ?? null;
      step = plan.step ?? null;
      failure = plan.failure ?? null;
    } catch {
      // Plan read error
    }

    return {
      planId: planSummary.planId,
      name: planSummary.name,
      status: planSummary.status,
      createdAt: planSummary.createdAt,
      scope,
      step,
      failure,
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

/**
 * GET /api/runs/:id — return plan and results merged into a single
 * response. The UI uses this for V1/V2/V3 to halve fetch counts and avoid
 * partial-state races between two separate requests.
 */
export function handleGetRun(storage: ReviewStorageService, res: http.ServerResponse, planId: string): void {
  let plan;
  try {
    plan = storage.getPlan(planId);
  } catch {
    sendError(res, 404, `Plan not found: ${planId}`);
    return;
  }

  // Results may not exist yet (e.g. plan was just created and no tasks
  // have completed). Returning null lets the UI render the in-progress state.
  let results: ReviewResults | null = null;
  try {
    results = storage.getResults(planId);
  } catch {
    results = null;
  }

  sendJson(res, { plan, results });
}

export function handleGetTaskLog(
  storage: ReviewStorageService,
  res: http.ServerResponse,
  planId: string,
  taskId: string,
): void {
  try {
    sendJson(res, storage.getTaskLog(planId, taskId));
  } catch {
    sendError(res, 404, `Task log not found: ${planId}/${taskId}`);
  }
}

export function handleGetPartitionerLog(
  storage: ReviewStorageService,
  res: http.ServerResponse,
  planId: string,
  reviewId: string,
): void {
  try {
    sendJson(res, storage.getPartitionerLog(planId, reviewId));
  } catch {
    sendError(res, 404, `Partitioner log not found: ${planId}/${reviewId}`);
  }
}
