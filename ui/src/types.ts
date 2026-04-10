// =============================================================================
// Mirror of src/types/review.ts and src/types/criteria.ts.
// Hand-written to match the backend exactly. Update both when either changes.
// =============================================================================

export type AgentModel = 'haiku' | 'sonnet' | 'opus'
export type AgentEffort = 'low' | 'medium' | 'high' | 'max'

export type FindingSeverity = 'critical' | 'warning' | 'info'

export type PlanStatus =
  | 'planning'
  | 'ready'
  | 'executing'
  | 'complete'
  | 'failed'

export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'error'

export type ResultsStatus = 'partial' | 'complete'

export type PipelineStep =
  | 'matching'
  | 'partitioning'
  | 'reviewing'
  | 'complete'
  | 'failed'

export interface PlanFailure {
  step: PipelineStep
  review_id: string | null
  message: string
}

export type Scope =
  | { type: 'all' }
  | { type: 'changes'; ref: string }

export interface PlanInvocation {
  command: string
  args: string[]
  cwd: string
}

export interface ReviewTask {
  task_id: string
  review_id: string
  review_file: string
  files: string[]
  scope: Scope
  focus: string | null
  hint: string | null
  model: AgentModel
  effort?: AgentEffort
  tools: string[]
  status: TaskStatus
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  prompt: string | null
}

export interface ModuleSummary {
  review_id: string
  description: string
  model: AgentModel
  partition: string
  task_count: number
  matched_files: string[]
}

export interface PartitionedSubtask {
  files: string[]
  focus: string | null
  hint: string | null
}

export interface PartitionDecision {
  review_id: string
  matched_files: string[]
  reasoning: string
  subtasks: PartitionedSubtask[]
  completed_at: string
  model: AgentModel
  usage: TaskUsage | null
}

export interface ReviewPlan {
  plan_id: string
  name: string
  invocation: PlanInvocation
  scope: Scope
  status: PlanStatus
  step: PipelineStep
  failure: PlanFailure | null
  created_at: string
  finalized_at: string | null
  started_at: string | null
  completed_at: string | null
  matched_files: string[]
  unmatched_files: string[]
  tasks: Record<string, ReviewTask>
  modules: Record<string, ModuleSummary>
  partition_decisions: Record<string, PartitionDecision>
}

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

export interface Reference {
  file: string
  symbol: string | null
  startLine: number
  endLine: number
  contextLines: number
  code: string | null
  suggestedCode: string | null
  note: string | null
}

export interface Issue {
  issue_id?: string
  severity: FindingSeverity
  description: string
  suggestion: string | null
  references: Reference[]
}

export interface FileIssue extends Issue {
  issue_id: string
  review_id: string
  task_id: string
}

export interface TaskResult {
  task_id: string
  review_id: string
  files: string[]
  completed_at: string
  issues: Issue[]
  usage: TaskUsage | null
}

export interface ModuleIssues {
  review_id: string
  description: string
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

export interface ReviewResults {
  plan_id: string
  status: ResultsStatus
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
  total_usage: TotalUsage
}

// =============================================================================
// API response shapes (mirror src/server/controllers/ReviewController.ts)
// =============================================================================

export interface RunSummary {
  planId: string
  name: string
  status: string
  createdAt: string
  scope: Scope | null
  step: PipelineStep | null
  failure: PlanFailure | null
  taskCount: number
  moduleCount: number
  moduleNames: string[]
  matchedFiles: number
  unmatchedFiles: number
  summary: ReviewResults['summary'] | null
  completion: ReviewResults['completion'] | null
}

/** Merged response from GET /api/runs/:id. */
export interface RunDetail {
  plan: ReviewPlan
  results: ReviewResults | null
}
