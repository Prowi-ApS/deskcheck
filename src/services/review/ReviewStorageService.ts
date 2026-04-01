import fs from "node:fs";
import path from "node:path";
import type {
  ContextType,
  Issue,
  FileIssue,
  ModuleIssues,
  ModuleSummary,
  ReviewPlan,
  ReviewResults,
  ReviewSource,
  ReviewTask,
  TaskResult,
  TaskUsage,
  TotalUsage,
} from "../../types/review.js";

// =============================================================================
// Helpers
// =============================================================================

/** Format a Date as YYYY-MM-DD_HHmmss for use as a plan ID / directory name. */
function formatTimestamp(date: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

/** Convert a review_id like "architecture/dto-enforcement" to "architecture--dto-enforcement". */
function flattenReviewId(reviewId: string): string {
  return reviewId.replace(/\//g, "--");
}

/** Zero-pad a number to 3 digits. */
function zeroPad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Stale threshold for in_progress tasks (5 minutes in milliseconds). */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Maximum time to wait for a file lock (milliseconds). */
const LOCK_MAX_WAIT_MS = 10_000;

/** Spin delay between lock checks (milliseconds). */
const LOCK_SPIN_MS = 50;

// =============================================================================
// ReviewStorageService
// =============================================================================

/**
 * Manages the two-file storage format (plan.json + results.json) for deskcheck runs.
 *
 * Each deskcheck run lives in a timestamped directory under the configured storage
 * directory. The plan file tracks tasks and coverage; the results file tracks
 * findings and aggregations.
 */
export class ReviewStorageService {
  private readonly storageDir: string;

  /** Tracks active lock file paths so they can be cleaned up on process exit. */
  private static activeLocks = new Set<string>();

  static {
    const cleanup = (): void => {
      for (const lockPath of ReviewStorageService.activeLocks) {
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      }
    };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(130); });
    process.on("SIGTERM", () => { cleanup(); process.exit(143); });
  }

  constructor(storageDir: string) {
    this.storageDir = storageDir;
  }

  /**
   * Execute a function while holding a file-based lock for the given plan.
   *
   * Uses `{ flag: "wx" }` for atomic exclusive create — either the file is
   * created (lock acquired) or it already exists (another holder). This
   * eliminates the TOCTOU race of existsSync + writeFileSync.
   *
   * Stale locks are detected via a timestamp in the lock file body.
   */
  private withLock<T>(planId: string, fn: () => T): T {
    const lockPath = path.join(this.planDir(planId), ".lock");
    const start = Date.now();

    // Acquire lock using atomic exclusive create
    while (true) {
      try {
        fs.writeFileSync(
          lockPath,
          JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
          { flag: "wx" },
        );
        break; // Lock acquired
      } catch (err: unknown) {
        // File already exists — another process holds the lock
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          // Check for stale lock (holder may have crashed)
          try {
            const lockData = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
            if (typeof lockData.timestamp === "number" && Date.now() - lockData.timestamp > LOCK_MAX_WAIT_MS) {
              // Stale lock — force remove and retry
              try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
              continue;
            }
          } catch {
            // Can't read lock file — force remove and retry
            try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
            continue;
          }

          if (Date.now() - start > LOCK_MAX_WAIT_MS) {
            throw new Error(`Storage lock timeout for plan ${planId}. Lock file: ${lockPath}`);
          }

          // Non-blocking wait using Atomics.wait on a shared buffer
          const wait = new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(wait, 0, 0, LOCK_SPIN_MS);
          continue;
        }
        throw err; // Unexpected error
      }
    }

    ReviewStorageService.activeLocks.add(lockPath);
    try {
      return fn();
    } finally {
      ReviewStorageService.activeLocks.delete(lockPath);
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }

  /** Get the directory path for a plan. */
  private planDir(planId: string): string {
    return path.join(this.storageDir, planId);
  }

  // ---------------------------------------------------------------------------
  // Plan Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new review plan with an empty task set.
   *
   * Creates the timestamped directory and writes an initial plan.json with
   * status "planning" and empty collections.
   */
  createPlan(name: string, source: ReviewSource): ReviewPlan {
    const now = new Date();
    const planId = formatTimestamp(now);
    const planDir = path.join(this.storageDir, planId);

    fs.mkdirSync(planDir, { recursive: true });

    const plan: ReviewPlan = {
      plan_id: planId,
      name,
      source,
      status: "planning",
      created_at: now.toISOString(),
      finalized_at: null,
      started_at: null,
      completed_at: null,
      matched_files: [],
      unmatched_files: [],
      tasks: {},
      modules: {},
    };

    this.writePlan(planId, plan);
    return plan;
  }

  /** Read the plan.json for a given plan ID. */
  getPlan(planId: string): ReviewPlan {
    const planPath = this.planPath(planId);
    const raw = fs.readFileSync(planPath, "utf-8");
    return JSON.parse(raw) as ReviewPlan;
  }

  /**
   * Return the most recent plan ID (latest timestamped directory), or null if
   * no plans exist.
   */
  getLatestPlanId(): string | null {
    if (!fs.existsSync(this.storageDir)) {
      return null;
    }

    const entries = fs.readdirSync(this.storageDir, { withFileTypes: true });
    const planDirs = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(this.storageDir, entry.name, "plan.json")),
      )
      .map((entry) => entry.name)
      .sort();

    if (planDirs.length === 0) {
      return null;
    }

    return planDirs[planDirs.length - 1];
  }

  /** List all plans with basic metadata. */
  listPlans(): Array<{
    planId: string;
    name: string;
    status: string;
    createdAt: string;
  }> {
    if (!fs.existsSync(this.storageDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.storageDir, { withFileTypes: true });
    const result: Array<{
      planId: string;
      name: string;
      status: string;
      createdAt: string;
    }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const planJsonPath = path.join(
        this.storageDir,
        entry.name,
        "plan.json",
      );
      if (!fs.existsSync(planJsonPath)) continue;

      const raw = fs.readFileSync(planJsonPath, "utf-8");
      const plan = JSON.parse(raw) as ReviewPlan;

      result.push({
        planId: plan.plan_id,
        name: plan.name,
        status: plan.status,
        createdAt: plan.created_at,
      });
    }

    return result.sort((a, b) => a.planId.localeCompare(b.planId));
  }

  /**
   * Finalize a plan by setting its status to "ready" and updating task counts
   * in module summaries.
   */
  finalizePlan(planId: string): ReviewPlan {
    return this.withLock(planId, () => {
      const plan = this.getPlan(planId);
      plan.status = "ready";
      plan.finalized_at = new Date().toISOString();

      // Recount tasks per module
      for (const moduleSummary of Object.values(plan.modules)) {
        moduleSummary.task_count = Object.values(plan.tasks).filter(
          (task) => task.review_id === moduleSummary.review_id,
        ).length;
      }

      this.writePlan(planId, plan);
      return plan;
    });
  }

  // ---------------------------------------------------------------------------
  // Task Management
  // ---------------------------------------------------------------------------

  /**
   * Add a task to an existing plan.
   *
   * Auto-generates the task_id by flattening slashes in the review_id and
   * appending a zero-padded incrementing suffix (e.g., "-001", "-002").
   * The task is created with status "pending" and null context fields.
   */
  addTask(
    planId: string,
    task: Omit<
      ReviewTask,
      | "task_id"
      | "status"
      | "created_at"
      | "started_at"
      | "completed_at"
      | "context"
      | "context_type"
      | "symbol"
      | "prompt"
    >,
  ): ReviewTask {
    return this.withLock(planId, () => {
      const plan = this.getPlan(planId);

      // Auto-generate task_id: flatten review_id and auto-increment
      const prefix = flattenReviewId(task.review_id);
      const existingCount = Object.keys(plan.tasks).filter((id) =>
        id.startsWith(prefix + "-"),
      ).length;
      const taskId = `${prefix}-${zeroPad3(existingCount + 1)}`;

      const newTask: ReviewTask = {
        task_id: taskId,
        review_id: task.review_id,
        review_file: task.review_file,
        files: task.files,
        hint: task.hint,
        model: task.model,
        status: "pending",
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        context_type: plan.source.type,
        context: null,
        symbol: null,
        prompt: null,
      };

      plan.tasks[taskId] = newTask;
      this.writePlan(planId, plan);
      return newTask;
    });
  }

  /**
   * Claim a pending task for execution.
   *
   * Sets the task status to "in_progress", fills in the context fields
   * (context type, content, symbol, prompt), and records the start time.
   */
  claimTask(
    planId: string,
    taskId: string,
    context: {
      contextType: ContextType;
      content: string;
      symbol?: string;
      prompt: string;
    },
  ): ReviewTask {
    return this.withLock(planId, () => {
      const plan = this.getPlan(planId);
      const task = plan.tasks[taskId];

      if (!task) {
        throw new Error(
          `Task "${taskId}" not found in plan "${planId}"`,
        );
      }

      task.status = "in_progress";
      task.started_at = new Date().toISOString();
      task.context_type = context.contextType;
      task.context = context.content;
      task.symbol = context.symbol ?? null;
      task.prompt = context.prompt;

      // Set plan to executing if it was ready
      if (plan.status === "ready") {
        plan.started_at = task.started_at;
        plan.status = "executing";
      }

      this.writePlan(planId, plan);
      return task;
    });
  }

  /**
   * Return tasks eligible for execution: those with status "pending" or
   * "in_progress" tasks that are stale (older than 5 minutes).
   */
  getPendingTasks(planId: string): ReviewTask[] {
    const plan = this.getPlan(planId);
    const now = Date.now();

    return Object.values(plan.tasks).filter((task) => {
      if (task.status === "pending") return true;
      if (task.status === "in_progress" && task.started_at) {
        const elapsed = now - new Date(task.started_at).getTime();
        return elapsed > STALE_THRESHOLD_MS;
      }
      return false;
    });
  }

  // ---------------------------------------------------------------------------
  // Result Management
  // ---------------------------------------------------------------------------

  /**
   * Mark a task as complete and record its findings.
   *
   * Updates the task status in plan.json, adds a TaskResult entry to
   * results.json, and recomputes all aggregations (by_file, by_module,
   * summary, completion).
   */
  completeTask(
    planId: string,
    taskId: string,
    issues: Issue[],
    usage?: TaskUsage | null,
  ): void {
    this.withLock(planId, () => {
      const now = new Date().toISOString();

      // Update plan.json task status
      const plan = this.getPlan(planId);
      const task = plan.tasks[taskId];

      if (!task) {
        throw new Error(
          `Task "${taskId}" not found in plan "${planId}"`,
        );
      }

      task.status = "complete";
      task.completed_at = now;

      // Check if all tasks have reached a terminal status (complete or error)
      const allDone = Object.values(plan.tasks).every(
        (t) => t.status === "complete" || t.status === "error",
      );

      if (allDone) {
        plan.status = "complete";
        plan.completed_at = now;
      }

      this.writePlan(planId, plan);

      // Add task result to results.json
      const taskResult: TaskResult = {
        task_id: taskId,
        review_id: task.review_id,
        files: task.files,
        completed_at: now,
        issues,
        usage: usage ?? null,
      };

      const results = this.loadOrCreateResults(planId);
      results.task_results[taskId] = taskResult;

      // Recompute all aggregations from scratch
      this.recomputeAggregations(results, plan);

      this.writeResults(planId, results);
    });
  }

  /**
   * Mark a task as errored.
   *
   * Sets the task status to "error" without recording any findings.
   * Updates plan.json and recomputes result aggregations so the error
   * is reflected in completion counts.
   */
  errorTask(planId: string, taskId: string, errorMessage: string, usage?: TaskUsage | null): void {
    this.withLock(planId, () => {
      const now = new Date().toISOString();
      const plan = this.getPlan(planId);
      const task = plan.tasks[taskId];

      if (!task) {
        throw new Error(`Task "${taskId}" not found in plan "${planId}"`);
      }

      task.status = "error";
      task.completed_at = now;

      // Check if all tasks have reached a terminal status
      const allDone = Object.values(plan.tasks).every(
        (t) => t.status === "complete" || t.status === "error",
      );

      if (allDone) {
        plan.status = "complete";
        plan.completed_at = now;
      }

      this.writePlan(planId, plan);

      // Add task result to results.json (with empty findings but preserving usage data)
      const results = this.loadOrCreateResults(planId);

      if (usage) {
        const taskResult: TaskResult = {
          task_id: taskId,
          review_id: task.review_id,
          files: task.files,
          completed_at: now,
          issues: [],
          usage: usage ?? null,
        };
        results.task_results[taskId] = taskResult;
      }

      // Recompute aggregations so completion counts reflect the error
      this.recomputeAggregations(results, plan);
      this.writeResults(planId, results);
    });
  }

  /** Read the results.json for a given plan ID. */
  getResults(planId: string): ReviewResults {
    const resultsPath = this.resultsPath(planId);

    if (!fs.existsSync(resultsPath)) {
      // Return empty results if no results file exists yet
      return this.createEmptyResults(planId);
    }

    const raw = fs.readFileSync(resultsPath, "utf-8");
    return JSON.parse(raw) as ReviewResults;
  }

  // ---------------------------------------------------------------------------
  // Coverage
  // ---------------------------------------------------------------------------

  /** Set the matched and unmatched file lists in the plan. */
  setMatchedFiles(
    planId: string,
    matched: string[],
    unmatched: string[],
  ): void {
    this.withLock(planId, () => {
      const plan = this.getPlan(planId);
      plan.matched_files = matched;
      plan.unmatched_files = unmatched;
      this.writePlan(planId, plan);
    });
  }

  /** Set the per-module summaries in the plan. */
  setModules(
    planId: string,
    modules: Record<string, ModuleSummary>,
  ): void {
    this.withLock(planId, () => {
      const plan = this.getPlan(planId);
      plan.modules = modules;
      this.writePlan(planId, plan);
    });
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private planPath(planId: string): string {
    return path.join(this.storageDir, planId, "plan.json");
  }

  private resultsPath(planId: string): string {
    return path.join(this.storageDir, planId, "results.json");
  }

  private writePlan(planId: string, plan: ReviewPlan): void {
    const target = this.planPath(planId);
    const tmp = target + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(plan, null, 2) + "\n");
    fs.renameSync(tmp, target);
  }

  private writeResults(planId: string, results: ReviewResults): void {
    const target = this.resultsPath(planId);
    const tmp = target + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(results, null, 2) + "\n");
    fs.renameSync(tmp, target);
  }

  private createEmptyResults(planId: string): ReviewResults {
    return {
      plan_id: planId,
      status: "partial",
      updated_at: new Date().toISOString(),
      completion: {
        total: 0,
        completed: 0,
        pending: 0,
        in_progress: 0,
        errored: 0,
      },
      summary: {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
      },
      task_results: {},
      by_file: {},
      by_module: {},
      total_usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        cost_usd: 0,
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 0,
      },
    };
  }

  /**
   * Load existing results.json or create a new empty structure.
   */
  private loadOrCreateResults(planId: string): ReviewResults {
    const resultsPath = this.resultsPath(planId);

    if (fs.existsSync(resultsPath)) {
      const raw = fs.readFileSync(resultsPath, "utf-8");
      return JSON.parse(raw) as ReviewResults;
    }

    return this.createEmptyResults(planId);
  }

  /**
   * Recompute all derived aggregations in results from the task_results
   * and the current plan state.
   *
   * This rebuilds by_file, by_module, summary, and completion from scratch
   * on every completeTask call. Since there is a single orchestrator process,
   * this is safe and keeps the logic simple.
   */
  private recomputeAggregations(
    results: ReviewResults,
    plan: ReviewPlan,
  ): void {
    const now = new Date().toISOString();
    results.updated_at = now;

    // ---- Completion ----
    const tasks = Object.values(plan.tasks);
    results.completion = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "complete").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      in_progress: tasks.filter((t) => t.status === "in_progress").length,
      errored: tasks.filter((t) => t.status === "error").length,
    };

    // ---- Stamp issue_id on all issues ----
    for (const taskResult of Object.values(results.task_results)) {
      for (let i = 0; i < taskResult.issues.length; i++) {
        taskResult.issues[i]!.issue_id = `${taskResult.task_id}:${i}`;
      }
    }

    // ---- Summary (aggregate issue counts) ----
    const summary = { total: 0, critical: 0, warning: 0, info: 0 };

    for (const taskResult of Object.values(results.task_results)) {
      for (const issue of taskResult.issues) {
        summary.total++;
        summary[issue.severity]++;
      }
    }
    results.summary = summary;

    // ---- by_file (group issues by reference file paths) ----
    // An issue can appear under multiple files if it has multiple references.
    const byFile: Record<string, FileIssue[]> = {};

    for (const taskResult of Object.values(results.task_results)) {
      for (const issue of taskResult.issues) {
        const fileIssue: FileIssue = {
          ...issue,
          issue_id: issue.issue_id!,
          review_id: taskResult.review_id,
          task_id: taskResult.task_id,
        };

        // Index under each referenced file path
        const seenFiles = new Set<string>();
        for (const ref of issue.references) {
          if (ref.file && !seenFiles.has(ref.file)) {
            seenFiles.add(ref.file);
            if (!byFile[ref.file]) {
              byFile[ref.file] = [];
            }
            byFile[ref.file].push(fileIssue);
          }
        }
      }
    }
    results.by_file = byFile;

    // ---- by_module (group issues by criterion) ----
    const byModule: Record<string, ModuleIssues> = {};

    for (const taskResult of Object.values(results.task_results)) {
      const reviewId = taskResult.review_id;

      if (!byModule[reviewId]) {
        // Look up module metadata from the plan
        const moduleSummary = plan.modules[reviewId];
        byModule[reviewId] = {
          review_id: reviewId,
          description: moduleSummary?.description ?? "",
          severity: moduleSummary?.severity ?? "medium",
          task_count: moduleSummary?.task_count ?? 0,
          completed: 0,
          counts: { critical: 0, warning: 0, info: 0, total: 0 },
          issues: [],
        };
      }

      const moduleIssues = byModule[reviewId];
      moduleIssues.completed++;

      for (const issue of taskResult.issues) {
        moduleIssues.counts.total++;
        moduleIssues.counts[issue.severity]++;
        moduleIssues.issues.push(issue);
      }
    }
    results.by_module = byModule;

    // ---- Status ----
    // A result set is "complete" when all tasks have reached a terminal state
    // (either completed successfully or errored out).
    const terminalCount = results.completion.completed + results.completion.errored;
    results.status =
      terminalCount === results.completion.total
        ? "complete"
        : "partial";

    // ---- Total Usage ----
    const totalUsage: TotalUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: 0,
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: 0,
    };

    for (const taskResult of Object.values(results.task_results)) {
      if (taskResult.usage) {
        totalUsage.input_tokens += taskResult.usage.input_tokens;
        totalUsage.output_tokens += taskResult.usage.output_tokens;
        totalUsage.cache_read_tokens += taskResult.usage.cache_read_tokens;
        totalUsage.cache_creation_tokens += taskResult.usage.cache_creation_tokens;
        totalUsage.cost_usd += taskResult.usage.cost_usd;
        totalUsage.duration_ms += taskResult.usage.duration_ms;
        totalUsage.duration_api_ms += taskResult.usage.duration_api_ms;
        totalUsage.num_turns += taskResult.usage.num_turns;
      }
    }

    results.total_usage = totalUsage;
  }
}
