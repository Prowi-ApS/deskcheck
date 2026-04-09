// =============================================================================
// useRun — single-source-of-truth for one deskcheck run.
//
// Loads { plan, results } from the merged /api/runs/:id endpoint, exposes
// reactive refs, and derives everything the views need (criterion rollups,
// pipeline state, token breakdowns, issue lookups). All computeds tolerate
// null/missing data so in-progress runs render gracefully.
// =============================================================================

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { getRun } from '../api'
import type {
  FileIssue,
  PartitionDecision,
  PipelineStep,
  ReviewPlan,
  ReviewResults,
  ReviewTask,
  TaskUsage,
} from '../types'

// =============================================================================
// Pipeline state
// =============================================================================

export type PipelineCellState = 'done' | 'active' | 'pending' | 'failed'

export interface PipelineState {
  matching: PipelineCellState
  partitioning: PipelineCellState
  reviewing: PipelineCellState
  complete: PipelineCellState
}

const STEP_ORDER: PipelineStep[] = ['matching', 'partitioning', 'reviewing', 'complete']

function pipelineStateFor(plan: ReviewPlan | null): PipelineState {
  const empty: PipelineState = {
    matching: 'pending',
    partitioning: 'pending',
    reviewing: 'pending',
    complete: 'pending',
  }
  if (!plan) return empty

  // Failed run: every step up to and including the failed step is done,
  // the failed step itself is failed, later steps are pending.
  if (plan.step === 'failed' && plan.failure) {
    const failedStep = plan.failure.step
    const failedIdx = STEP_ORDER.indexOf(failedStep)
    return {
      matching: failedIdx > 0 ? 'done' : failedIdx === 0 ? 'failed' : 'pending',
      partitioning:
        failedIdx > 1 ? 'done' : failedIdx === 1 ? 'failed' : 'pending',
      reviewing: failedIdx > 2 ? 'done' : failedIdx === 2 ? 'failed' : 'pending',
      complete: 'pending',
    }
  }

  const idx = STEP_ORDER.indexOf(plan.step)
  if (idx === -1) return empty

  const cell = (i: number): PipelineCellState => {
    if (i < idx) return 'done'
    if (i === idx) return plan.step === 'complete' ? 'done' : 'active'
    return 'pending'
  }

  return {
    matching: cell(0),
    partitioning: cell(1),
    reviewing: cell(2),
    complete: cell(3),
  }
}

// =============================================================================
// Criterion rollup
// =============================================================================

export type CriterionStatus = 'pending' | 'in_progress' | 'clean' | 'has_issues' | 'errored'

export interface CriterionRow {
  review_id: string
  label: string
  status: CriterionStatus
  decision: PartitionDecision | null
  subtasks: SubtaskRow[]
  totalDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  issueCount: number
}

export interface SubtaskRow {
  task_id: string
  review_id: string
  files: string[]
  focus: string | null
  hint: string | null
  status: CriterionStatus
  taskStatus: ReviewTask['status']
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  issueCount: number
  error: string | null
  task: ReviewTask
}

function statusForTask(task: ReviewTask, issueCount: number): CriterionStatus {
  if (task.status === 'pending') return 'pending'
  if (task.status === 'in_progress') return 'in_progress'
  if (task.status === 'error') return 'errored'
  return issueCount > 0 ? 'has_issues' : 'clean'
}

function rollupCriterionStatus(rows: SubtaskRow[]): CriterionStatus {
  if (rows.some((r) => r.status === 'errored')) return 'errored'
  if (rows.some((r) => r.status === 'in_progress')) return 'in_progress'
  if (rows.some((r) => r.status === 'pending')) return 'pending'
  if (rows.some((r) => r.status === 'has_issues')) return 'has_issues'
  return 'clean'
}

// =============================================================================
// Token breakdown
// =============================================================================

export interface TokenBreakdown {
  partition: { input: number; output: number; cost: number }
  review: { input: number; output: number; cost: number }
}

function emptyUsage(): { input: number; output: number; cost: number } {
  return { input: 0, output: 0, cost: 0 }
}

function addUsage(
  acc: { input: number; output: number; cost: number },
  u: TaskUsage | null,
): void {
  if (!u) return
  acc.input += u.input_tokens
  acc.output += u.output_tokens
  acc.cost += u.cost_usd
}

// =============================================================================
// Composable
// =============================================================================

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const

export interface UseRun {
  plan: Ref<ReviewPlan | null>
  results: Ref<ReviewResults | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  refresh: () => Promise<void>
  // Derived
  pipelineState: ComputedRef<PipelineState>
  criterionRows: ComputedRef<CriterionRow[]>
  tokenBreakdown: ComputedRef<TokenBreakdown>
  allIssues: ComputedRef<FileIssue[]>
  // Lookups
  criterionRow: (reviewId: string) => CriterionRow | null
  subtaskRow: (taskId: string) => SubtaskRow | null
  issuesForTask: (taskId: string) => FileIssue[]
  issuesForCriterion: (reviewId: string) => FileIssue[]
}

export function useRun(planId: string): UseRun {
  const plan = ref<ReviewPlan | null>(null)
  const results = ref<ReviewResults | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const data = await getRun(planId)
      plan.value = data.plan
      results.value = data.results
      error.value = null
    } catch (err) {
      // Defensive: SSE notifications can land mid-write. Skip the tick and
      // log; the next refresh will pick up a clean read.
      console.warn('[useRun] refresh failed:', err)
    } finally {
      loading.value = false
    }
  }

  // -- Derived --

  const pipelineState = computed<PipelineState>(() => pipelineStateFor(plan.value))

  const criterionRows = computed<CriterionRow[]>(() => {
    const p = plan.value
    if (!p) return []
    const r = results.value
    const reviewIds = Object.keys(p.partition_decisions).sort()

    return reviewIds.map((reviewId) => {
      const decision = p.partition_decisions[reviewId] ?? null
      const tasksForCriterion: ReviewTask[] = Object.values(p.tasks).filter(
        (t) => t.review_id === reviewId,
      )

      const subtasks: SubtaskRow[] = tasksForCriterion.map((task) => {
        const taskResult = r?.task_results[task.task_id]
        const issueCount = taskResult?.issues.length ?? 0
        const usage = taskResult?.usage ?? null
        return {
          task_id: task.task_id,
          review_id: task.review_id,
          files: task.files,
          focus: task.focus,
          hint: task.hint,
          status: statusForTask(task, issueCount),
          taskStatus: task.status,
          durationMs: usage?.duration_ms ?? 0,
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          costUsd: usage?.cost_usd ?? 0,
          issueCount,
          error: task.error,
          task,
        }
      })

      const partitionerDuration = decision?.usage?.duration_ms ?? 0
      const partitionerInput = decision?.usage?.input_tokens ?? 0
      const partitionerOutput = decision?.usage?.output_tokens ?? 0
      const partitionerCost = decision?.usage?.cost_usd ?? 0

      const reviewerDuration = subtasks.reduce((s, t) => s + t.durationMs, 0)
      const reviewerInput = subtasks.reduce((s, t) => s + t.inputTokens, 0)
      const reviewerOutput = subtasks.reduce((s, t) => s + t.outputTokens, 0)
      const reviewerCost = subtasks.reduce((s, t) => s + t.costUsd, 0)
      const issueCount = subtasks.reduce((s, t) => s + t.issueCount, 0)

      return {
        review_id: reviewId,
        label: reviewId.split('/').pop() ?? reviewId,
        status: rollupCriterionStatus(subtasks),
        decision,
        subtasks,
        totalDurationMs: partitionerDuration + reviewerDuration,
        totalInputTokens: partitionerInput + reviewerInput,
        totalOutputTokens: partitionerOutput + reviewerOutput,
        totalCostUsd: partitionerCost + reviewerCost,
        issueCount,
      }
    })
  })

  const tokenBreakdown = computed<TokenBreakdown>(() => {
    const breakdown: TokenBreakdown = {
      partition: emptyUsage(),
      review: emptyUsage(),
    }
    const p = plan.value
    if (!p) return breakdown
    for (const decision of Object.values(p.partition_decisions)) {
      addUsage(breakdown.partition, decision.usage)
    }
    const r = results.value
    if (r) {
      for (const tr of Object.values(r.task_results)) {
        addUsage(breakdown.review, tr.usage)
      }
    }
    return breakdown
  })

  const allIssues = computed<FileIssue[]>(() => {
    const r = results.value
    if (!r) return []
    const issues: FileIssue[] = []
    for (const tr of Object.values(r.task_results)) {
      for (const issue of tr.issues) {
        issues.push({
          ...issue,
          issue_id: issue.issue_id ?? `${tr.task_id}:${issues.length}`,
          review_id: tr.review_id,
          task_id: tr.task_id,
        })
      }
    }
    issues.sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (sevDiff !== 0) return sevDiff
      return a.review_id.localeCompare(b.review_id)
    })
    return issues
  })

  // -- Lookups --

  function criterionRow(reviewId: string): CriterionRow | null {
    return criterionRows.value.find((r) => r.review_id === reviewId) ?? null
  }

  function subtaskRow(taskId: string): SubtaskRow | null {
    for (const cr of criterionRows.value) {
      const found = cr.subtasks.find((s) => s.task_id === taskId)
      if (found) return found
    }
    return null
  }

  function issuesForTask(taskId: string): FileIssue[] {
    return allIssues.value.filter((i) => i.task_id === taskId)
  }

  function issuesForCriterion(reviewId: string): FileIssue[] {
    return allIssues.value.filter((i) => i.review_id === reviewId)
  }

  return {
    plan,
    results,
    loading,
    error,
    refresh,
    pipelineState,
    criterionRows,
    tokenBreakdown,
    allIssues,
    criterionRow,
    subtaskRow,
    issuesForTask,
    issuesForCriterion,
  }
}

// =============================================================================
// useElapsed — live-ticking duration helper
// =============================================================================

import { onMounted, onUnmounted } from 'vue'

/**
 * Returns a reactive ms duration between `startedAt` and either `endedAt`
 * (if set) or now. Ticks once per second while `endedAt` is null. Use for
 * stat-card "Elapsed" displays on in-progress runs.
 */
export function useElapsed(
  startedAt: Ref<string | null>,
  endedAt: Ref<string | null>,
): Ref<number> {
  const ms = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function tick() {
    if (!startedAt.value) {
      ms.value = 0
      return
    }
    const start = new Date(startedAt.value).getTime()
    const end = endedAt.value ? new Date(endedAt.value).getTime() : Date.now()
    ms.value = Math.max(0, end - start)
  }

  onMounted(() => {
    tick()
    timer = setInterval(() => {
      if (endedAt.value) {
        tick()
        return
      }
      tick()
    }, 1000)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return ms
}
