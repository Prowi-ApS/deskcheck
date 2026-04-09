// =============================================================================
// Typed HTTP client for the deskcheck server.
//
// All functions are defensive: a JSON parse error or non-2xx response throws,
// callers wrap their fetches in try/catch and skip-on-error rather than
// propagating partial state to the UI. This matches the watch/SSE refresh
// pattern where occasional half-written files are normal.
// =============================================================================

import type { RunSummary, RunDetail } from './types'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`)
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from ${url}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export function listRuns(): Promise<RunSummary[]> {
  return fetchJson<RunSummary[]>('/api/runs')
}

export function getRun(planId: string): Promise<RunDetail> {
  return fetchJson<RunDetail>(`/api/runs/${encodeURIComponent(planId)}`)
}

/**
 * Reviewer agent transcript for one task. Dormant — exposed in case power
 * users want to hit it directly. The current UI doesn't render this.
 */
export function getTaskLog(planId: string, taskId: string): Promise<unknown[]> {
  return fetchJson<unknown[]>(
    `/api/runs/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/log`,
  )
}

/**
 * Partitioner agent transcript for one criterion. Dormant — same as task log.
 */
export function getPartitionerLog(
  planId: string,
  reviewId: string,
): Promise<unknown[]> {
  return fetchJson<unknown[]>(
    `/api/runs/${encodeURIComponent(planId)}/partitioners/${encodeURIComponent(reviewId)}/log`,
  )
}
