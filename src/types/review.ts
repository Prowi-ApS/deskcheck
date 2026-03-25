import type { AgentModel, ModuleSeverity } from "./criteria.js";

// =============================================================================
// Common Union Types
// =============================================================================

/** Severity level assigned to an individual finding. */
export type FindingSeverity = "critical" | "warning" | "info";

/** How the source content is provided to executors. */
export type ContextType = "diff" | "file" | "symbol";

/** Lifecycle status of a deskcheck plan. */
export type PlanStatus = "planning" | "ready" | "executing" | "complete";

/** Lifecycle status of an individual deskcheck task. */
export type TaskStatus = "pending" | "in_progress" | "complete" | "error";

/** Whether results cover all tasks or only a subset. */
export type ResultsStatus = "partial" | "complete";

// =============================================================================
// Storage Types — plan.json
// =============================================================================

/** What is being reviewed — a diff, file, or symbol. */
export interface ReviewSource {
  /** The kind of content being reviewed. */
  type: ContextType;
  /** Target identifier: branch name (diff), file path (file), or symbol name (symbol). */
  target: string;
  /** Only for symbol mode — the file containing the symbol. */
  file?: string;
}

/** A single review task assigned to an executor agent. */
export interface ReviewTask {
  /** Unique task identifier, e.g. "architecture--dto-enforcement-001". */
  task_id: string;
  /** Review module identifier, e.g. "architecture/dto-enforcement". */
  review_id: string;
  /** Relative path to the criterion file. */
  review_file: string;
  /** Files assigned to this task. */
  files: string[];
  /** Optional planner hint describing scope or focus area. */
  hint: string | null;
  /** Claude model tier for the executor agent. */
  model: AgentModel;
  /** Current lifecycle status. */
  status: TaskStatus;
  /** ISO 8601 timestamp when this task was created. */
  created_at: string;
  /** ISO 8601 timestamp when execution started. */
  started_at: string | null;
  /** ISO 8601 timestamp when execution completed. */
  completed_at: string | null;

  /** How context was provided to the executor (diff, file content, or symbol). */
  context_type: ContextType;
  /** The actual context content (pruneable after completion). */
  context: string | null;
  /** Only for symbol mode — the symbol being reviewed. */
  symbol: string | null;
  /** The detective prompt from the criterion (pruneable after completion). */
  prompt: string | null;
}

/** Summary of a criterion's role in a plan. */
export interface ModuleSummary {
  /** Review module identifier. */
  review_id: string;
  /** Human-readable description from frontmatter. */
  description: string;
  /** Criterion severity level. */
  severity: ModuleSeverity;
  /** Claude model tier from frontmatter. */
  model: AgentModel;
  /** Number of tasks created for this criterion. */
  task_count: number;
  /** Files that matched this module's globs. */
  matched_files: string[];
}

/** The complete deskcheck plan written to plan.json. */
export interface ReviewPlan {
  /** Unique plan identifier, e.g. "2026-03-19_143022". */
  plan_id: string;
  /** Human-readable name, e.g. "feature/order-rework vs develop". */
  name: string;
  /** What is being reviewed. */
  source: ReviewSource;
  /** Current lifecycle status. */
  status: PlanStatus;
  /** ISO 8601 timestamp when the plan was created. */
  created_at: string;
  /** ISO 8601 timestamp when planning was finalized. */
  finalized_at: string | null;
  /** ISO 8601 timestamp when execution started. */
  started_at: string | null;
  /** ISO 8601 timestamp when all tasks completed. */
  completed_at: string | null;

  /** Files that matched at least one criterion. */
  matched_files: string[];
  /** Files with no matching criterion (coverage gaps). */
  unmatched_files: string[];

  /** All tasks keyed by task_id. */
  tasks: Record<string, ReviewTask>;
  /** Per-module summaries keyed by review_id. */
  modules: Record<string, ModuleSummary>;
}

// =============================================================================
// Usage Types
// =============================================================================

/** Token usage and timing data from an executor agent run. */
export interface TaskUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  model: string;
}

/** Aggregated token usage across all tasks in a run. */
export interface TotalUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
}

// =============================================================================
// Storage Types — results.json
// =============================================================================

/** A single finding produced by an executor agent. */
export interface Finding {
  /** How severe this finding is. */
  severity: FindingSeverity;
  /** File path where the issue was found. */
  file: string;
  /** Line number where the issue occurs, if applicable. */
  line: number | null;
  /** Description of the issue. */
  description: string;
  /** Suggested fix or improvement, if applicable. */
  suggestion: string | null;
}

/** A finding enriched with its source module and task for by-file grouping. */
export interface FileFinding extends Finding {
  /** Which criterion produced this finding. */
  review_id: string;
  /** Which task produced this finding. */
  task_id: string;
}

/** Results from a single completed task. */
export interface TaskResult {
  /** The task that produced these results. */
  task_id: string;
  /** The criterion that was applied. */
  review_id: string;
  /** Files that were reviewed. */
  files: string[];
  /** ISO 8601 timestamp when the task completed. */
  completed_at: string;
  /** Findings produced by the executor agent. */
  findings: Finding[];
  /** Token usage and timing from the executor agent. Null for legacy results. */
  usage: TaskUsage | null;
}

/** Aggregated findings for a single criterion. */
export interface ModuleFindings {
  /** Review module identifier. */
  review_id: string;
  /** Human-readable description. */
  description: string;
  /** Criterion severity level. */
  severity: ModuleSeverity;
  /** Total number of tasks for this criterion. */
  task_count: number;
  /** Number of completed tasks. */
  completed: number;
  /** Aggregated finding counts by severity. */
  counts: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  /** All findings from this module's tasks. */
  findings: Finding[];
}

/** The complete deskcheck results written to results.json. */
export interface ReviewResults {
  /** Matches the plan_id from plan.json. */
  plan_id: string;
  /** Whether all tasks have completed. */
  status: ResultsStatus;
  /** ISO 8601 timestamp of the last update. */
  updated_at: string;

  /** Task completion tracking. */
  completion: {
    total: number;
    completed: number;
    pending: number;
    in_progress: number;
    errored: number;
  };

  /** Aggregated finding counts across all tasks. */
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };

  /** Per-task results keyed by task_id. */
  task_results: Record<string, TaskResult>;
  /** Findings grouped by file path. */
  by_file: Record<string, FileFinding[]>;
  /** Findings grouped by criterion. */
  by_module: Record<string, ModuleFindings>;
  /** Aggregated token usage across all completed tasks. */
  total_usage: TotalUsage;
}
