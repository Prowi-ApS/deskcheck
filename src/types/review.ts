import type { AgentEffort, AgentModel } from "./criteria.js";

// =============================================================================
// Common Union Types
// =============================================================================

/** Severity level assigned to an individual finding. */
export type FindingSeverity = "critical" | "warning" | "info";

/** Lifecycle status of a deskcheck plan. */
export type PlanStatus = "planning" | "ready" | "executing" | "complete" | "failed";

/** Lifecycle status of an individual deskcheck task. */
export type TaskStatus = "pending" | "in_progress" | "complete" | "error";

/** Whether results cover all tasks or only a subset. */
export type ResultsStatus = "partial" | "complete";

/**
 * Pipeline step the plan is currently in. Distinct from `PlanStatus` because
 * `planning` covers both matching and partitioning, which the UI needs to
 * distinguish. Updated by the plan-builder as it progresses.
 */
export type PipelineStep =
  | "matching"
  | "partitioning"
  | "reviewing"
  | "complete"
  | "failed";

/**
 * If a run failed, what failed and where. Persisted on the plan so the UI
 * can render which step turned red and which criterion (if any) was the
 * culprit.
 */
export interface PlanFailure {
  /** Which step the run was in when it failed. */
  step: PipelineStep;
  /** Criterion id, if the failure was scoped to one (e.g. partitioner crash). Null for run-wide failures. */
  review_id: string | null;
  /** Human-readable error message. */
  message: string;
}

// =============================================================================
// Scope
// =============================================================================

/**
 * What the reviewer should look at, resolved at invocation time.
 *
 * - `all` — review the assigned files in their entirety.
 * - `changes` — review only what changed against the given git ref. The reviewer
 *   produces its own context by running `git diff <ref> -- <file>`.
 */
export type Scope =
  | { type: "all" }
  | { type: "changes"; ref: string };

// =============================================================================
// Storage Types — plan.json
// =============================================================================

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
  /** Scope for this task — copied from the plan. */
  scope: Scope;
  /**
   * Optional sub-file narrowing set by the partitioner — e.g. a method name
   * when one criterion is partitioned "one method per task". The reviewer
   * still gets the full files list, but only reports issues within `focus`.
   */
  focus: string | null;
  /** Optional partitioner hint explaining why these files were grouped. */
  hint: string | null;
  /** Claude model tier for the executor agent. */
  model: AgentModel;
  /** Agent SDK effort level. Undefined = SDK default. */
  effort?: AgentEffort;
  /**
   * Extra tool names this reviewer should have access to, copied from the
   * criterion's frontmatter at addTask time. Layered on top of the built-in
   * reviewer tools and config-level tools by ExecutorService.
   */
  tools: string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** ISO 8601 timestamp when this task was created. */
  created_at: string;
  /** ISO 8601 timestamp when execution started. */
  started_at: string | null;
  /** ISO 8601 timestamp when execution completed. */
  completed_at: string | null;
  /**
   * Error message if `status === "error"`. Null otherwise. Persisted so the
   * UI can show what went wrong on a per-subtask basis after the run.
   */
  error: string | null;

  /** The detective prompt from the criterion (pruneable after completion). */
  prompt: string | null;
}

/** Summary of a criterion's role in a plan. */
export interface ModuleSummary {
  /** Review module identifier. */
  review_id: string;
  /** Human-readable description from frontmatter. */
  description: string;
  /** Claude model tier from frontmatter. */
  model: AgentModel;
  /** Natural-language partition instruction from frontmatter, copied here so the UI can display it without re-reading the criterion file. */
  partition: string;
  /** Number of tasks created for this criterion. */
  task_count: number;
  /** Files that matched this module's globs. */
  matched_files: string[];
}

/**
 * How the user invoked deskcheck for this run. Persisted on the plan so
 * runs are reproducible from inspection alone.
 */
export interface PlanInvocation {
  /** The argv[0]-equivalent program name (always "deskcheck"). */
  command: string;
  /** The remaining argv passed to deskcheck (subcommand + flags + positionals). */
  args: string[];
  /** Working directory at invocation time. */
  cwd: string;
}

/** The complete deskcheck plan written to plan.json. */
export interface ReviewPlan {
  /** Unique plan identifier, e.g. "2026-03-19_143022". */
  plan_id: string;
  /** Human-readable name, e.g. "feature/order-rework vs develop". */
  name: string;
  /** How the user invoked deskcheck for this run. */
  invocation: PlanInvocation;
  /** What the reviewers should look at. */
  scope: Scope;
  /** Current lifecycle status. */
  status: PlanStatus;
  /**
   * Pipeline step the plan-builder/orchestrator are currently in. More
   * granular than `status` because `planning` covers matching+partitioning.
   */
  step: PipelineStep;
  /** If the run failed, what went wrong. Null on success and in-progress runs. */
  failure: PlanFailure | null;
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
  /** Partitioner output per criterion, keyed by review_id. */
  partition_decisions: Record<string, PartitionDecision>;
}

/**
 * Output of one partitioner agent run for one criterion.
 *
 * Captures the partitioner's overall reasoning and a snapshot of the
 * subtasks it produced, so a stored plan is fully inspectable. The actual
 * tasks live in `ReviewPlan.tasks`; this is the audit trail of how they
 * came to be.
 */
export interface PartitionDecision {
  /** The criterion this decision applies to. */
  review_id: string;
  /** Files the partitioner was given (the glob match output). */
  matched_files: string[];
  /** The partitioner agent's overall reasoning for the grouping. */
  reasoning: string;
  /** The subtasks the partitioner emitted (also reflected in plan.tasks). */
  subtasks: PartitionedSubtask[];
  /** ISO 8601 timestamp when this partition completed. */
  completed_at: string;
  /** Claude model tier used for the partitioner agent. */
  model: AgentModel;
  /** Token usage and timing for the partitioner agent run. */
  usage: TaskUsage | null;
}

/** A subtask emitted by the partitioner for a single criterion. */
export interface PartitionedSubtask {
  /** Files assigned to this subtask. May overlap with other subtasks if `focus` differs. */
  files: string[];
  /** Sub-file narrowing — e.g. a method name when partitioning "one method per task". */
  focus: string | null;
  /** Short explanation of why these files were grouped together. */
  hint: string | null;
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

/** A code location referenced by an issue. */
export interface Reference {
  /** File path where the issue manifests. */
  file: string;
  /** Semantic symbol anchor, e.g. "ClassName::method". Stable across refactors. */
  symbol: string | null;
  /** Start line of the flagged range (inclusive). */
  startLine: number;
  /** End line of the flagged range (inclusive). */
  endLine: number;
  /** How many lines of surrounding context to include in the code snippet. */
  contextLines: number;
  /**
   * The actual code at this location, extracted from disk by post-processing.
   * Null at parse time — populated by CodeSnippetService before writing results.
   */
  code: string | null;
  /** Suggested replacement code (optional fix). */
  suggestedCode: string | null;
  /** Why this reference is relevant to the issue. */
  note: string | null;
}

/** A single issue produced by an executor agent. */
export interface Issue {
  /** Stable identity, stamped by recomputeAggregations as `${task_id}:${index}`. */
  issue_id?: string;
  /** How severe this issue is. */
  severity: FindingSeverity;
  /** Description of what's wrong. */
  description: string;
  /** High-level suggested fix or improvement, if applicable. */
  suggestion: string | null;
  /** Where this issue manifests — one or more code locations. */
  references: Reference[];
}

/** An issue enriched with its source module and task for by-file grouping. */
export interface FileIssue extends Issue {
  /** Stable identity, always present on FileIssue (narrowed from optional). */
  issue_id: string;
  /** Which criterion produced this issue. */
  review_id: string;
  /** Which task produced this issue. */
  task_id: string;
}

/**
 * Legacy Finding type for backwards compatibility with old executor output.
 * @deprecated Use Issue instead.
 */
export interface Finding {
  severity: FindingSeverity;
  file: string;
  line: number | null;
  description: string;
  suggestion: string | null;
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
  /** Issues produced by the executor agent. */
  issues: Issue[];
  /** Token usage and timing from the executor agent. Null for legacy results. */
  usage: TaskUsage | null;
}

/** Aggregated issues for a single criterion. */
export interface ModuleIssues {
  /** Review module identifier. */
  review_id: string;
  /** Human-readable description. */
  description: string;
  /** Total number of tasks for this criterion. */
  task_count: number;
  /** Number of completed tasks. */
  completed: number;
  /** Aggregated issue counts by severity. */
  counts: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  /** All issues from this module's tasks. */
  issues: Issue[];
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

  /** Aggregated issue counts across all tasks. */
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };

  /** Per-task results keyed by task_id. */
  task_results: Record<string, TaskResult>;
  /** Issues grouped by file path (an issue appears under each referenced file). */
  by_file: Record<string, FileIssue[]>;
  /** Issues grouped by criterion. */
  by_module: Record<string, ModuleIssues>;
  /** Aggregated token usage across all completed tasks. */
  total_usage: TotalUsage;
}
