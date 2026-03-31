/** Severity level assigned to a criterion. */
export type ModuleSeverity = 'critical' | 'high' | 'medium' | 'low'

/** Severity level assigned to an individual issue. */
export type FindingSeverity = 'critical' | 'warning' | 'info'

/** Lifecycle status of a deskcheck plan. */
export type PlanStatus = 'planning' | 'ready' | 'executing' | 'complete'

/** Lifecycle status of an individual task. */
export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'error'

/** How the source content is provided. */
export type ContextType = 'diff' | 'file' | 'symbol'

/** What is being reviewed. */
export interface ReviewSource {
  type: ContextType
  target: string
  file?: string
}

/** A single review task. */
export interface ReviewTask {
  task_id: string
  review_id: string
  review_file: string
  files: string[]
  hint: string | null
  model: string
  status: TaskStatus
  created_at: string
  started_at: string | null
  completed_at: string | null
  context_type: ContextType
  context: string | null
  symbol: string | null
  prompt: string | null
}

/** Summary of a criterion's role in a plan. */
export interface ModuleSummary {
  review_id: string
  description: string
  severity: ModuleSeverity
  task_count: number
  matched_files: string[]
}

/** The complete deskcheck plan. */
export interface ReviewPlan {
  plan_id: string
  name: string
  source: ReviewSource
  status: PlanStatus
  created_at: string
  finalized_at: string | null
  started_at: string | null
  completed_at: string | null
  matched_files: string[]
  unmatched_files: string[]
  tasks: Record<string, ReviewTask>
  modules: Record<string, ModuleSummary>
}

/** A code location referenced by an issue. */
export interface Reference {
  file: string
  symbol: string | null
  line: number | null
  code: string | null
  suggestedCode: string | null
  note: string | null
}

/** A single issue produced by an executor agent. */
export interface Issue {
  issue_id?: string
  severity: FindingSeverity
  description: string
  suggestion: string | null
  references: Reference[]
}

/** An issue enriched with source module and task. */
export interface FileIssue extends Issue {
  issue_id: string
  review_id: string
  task_id: string
}

/** Token usage and timing data from an executor agent run. */
export interface TaskUsage {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cost_usd: number
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  model: string
}

/** Aggregated token usage across all tasks in a run. */
export interface TotalUsage {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cost_usd: number
  duration_ms: number
  duration_api_ms: number
  num_turns: number
}

/** Results from a single completed task. */
export interface TaskResult {
  task_id: string
  review_id: string
  files: string[]
  completed_at: string
  issues: Issue[]
  usage: TaskUsage | null
}

/** Aggregated issues for a single criterion. */
export interface ModuleIssues {
  review_id: string
  description: string
  severity: ModuleSeverity
  task_count: number
  completed: number
  counts: {
    critical: number
    warning: number
    info: number
    total: number
  }
  issues: Issue[]
}

/** The complete deskcheck results. */
export interface ReviewResults {
  plan_id: string
  status: 'partial' | 'complete'
  updated_at: string
  completion: {
    total: number
    completed: number
    pending: number
    in_progress: number
    errored: number
  }
  summary: {
    total: number
    critical: number
    warning: number
    info: number
  }
  task_results: Record<string, TaskResult>
  by_file: Record<string, FileIssue[]>
  by_module: Record<string, ModuleIssues>
  total_usage?: TotalUsage
}

/** A run summary returned by GET /api/runs. */
export interface RunSummary {
  planId: string
  name: string
  status: string
  createdAt: string
  sourceType: string | null
  sourceTarget: string | null
  taskCount: number
  moduleCount: number
  moduleNames: string[]
  matchedFiles: number
  unmatchedFiles: number
  summary: ReviewResults['summary'] | null
  completion: ReviewResults['completion'] | null
}
