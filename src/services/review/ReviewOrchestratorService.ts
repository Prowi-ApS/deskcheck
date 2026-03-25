import path from "node:path";
import { ReviewStorageService } from "./ReviewStorageService.js";
import { extractContext } from "./ReviewContextExtractorService.js";
import { buildExecutorPrompt } from "../../prompts/ExecutorPrompt.js";
import { parseFindings } from "../FindingsParserService.js";
import { ExecutorService } from "../ExecutorService.js";
import type { ReviewConfig } from "../../config/types.js";
import type {
  ReviewTask,
  TaskUsage,
} from "../../types/review.js";

// =============================================================================
// Event Types
// =============================================================================

/** Events yielded by the orchestrator's execute() async generator. */
export type OrchestratorEvent =
  | { type: "task_started"; taskId: string; reviewId: string; model: string; files: string[] }
  | { type: "task_completed"; taskId: string; reviewId: string; files: string[]; findingCount: number; usage: TaskUsage | null }
  | { type: "task_error"; taskId: string; reviewId: string; files: string[]; error: string }
  | { type: "batch_progress"; completed: number; total: number }
  | { type: "complete"; totalFindings: number };

// =============================================================================
// ReviewOrchestratorService
// =============================================================================

/**
 * Executes a review plan by dispatching tasks to executor agents via the
 * Claude Agent SDK and collecting their findings.
 *
 * Uses an async generator to yield progress events, allowing callers to
 * react to task starts, completions, errors, and overall progress in real time.
 */
export class ReviewOrchestratorService {
  private readonly config: ReviewConfig;
  private readonly projectRoot: string;
  private readonly executorService: ExecutorService;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
    this.executorService = new ExecutorService(config, projectRoot);
  }

  /**
   * Execute all pending tasks in a plan.
   *
   * Runs up to `maxConcurrent` executor agents at a time using a concurrency
   * pool. Each executor receives a system prompt built from the task, uses
   * the Claude Agent SDK to analyze the code, and outputs findings as JSON.
   */
  async *execute(
    planId: string,
    options?: { maxConcurrent?: number },
  ): AsyncGenerator<OrchestratorEvent> {
    const maxConcurrent = options?.maxConcurrent ?? 5;
    const storageDir = path.resolve(this.projectRoot, this.config.storage_dir);
    const storage = new ReviewStorageService(storageDir);

    const plan = storage.getPlan(planId);
    const pendingTasks = storage.getPendingTasks(planId);

    if (pendingTasks.length === 0) {
      yield { type: "complete", totalFindings: 0 };
      return;
    }

    let completedCount = 0;
    let totalFindings = 0;
    const total = pendingTasks.length;

    // Event queue: executor promises push events here, generator yields them
    const eventQueue: OrchestratorEvent[] = [];
    let resolveWaiting: (() => void) | null = null;

    function pushEvent(event: OrchestratorEvent): void {
      eventQueue.push(event);
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    }

    /** Run a single executor agent for a task. */
    const runExecutor = async (task: ReviewTask): Promise<void> => {
      const modelId = task.model;

      pushEvent({
        type: "task_started",
        taskId: task.task_id,
        reviewId: task.review_id,
        model: modelId,
        files: task.files,
      });

      let taskUsage: TaskUsage | null = null;
      try {
        // Extract context and claim the task
        const extracted = extractContext(
          plan.source.type,
          plan.source.target,
          task.files,
          this.projectRoot,
          task.symbol ?? undefined,
        );

        // Read the criterion prompt from the module file
        const modulePrompt = task.prompt ?? plan.modules[task.review_id]?.description ?? "";

        // Claim the task in storage (sets status to in_progress, fills context)
        storage.claimTask(planId, task.task_id, {
          contextType: extracted.contextType,
          content: extracted.content,
          symbol: extracted.symbol ?? undefined,
          prompt: modulePrompt,
        });

        // Re-read the task with filled context for prompt building
        const claimedPlan = storage.getPlan(planId);
        const claimedTask = claimedPlan.tasks[task.task_id]!;

        // Build the executor prompt
        const executorPrompt = buildExecutorPrompt(claimedTask);

        // Spawn executor agent via ExecutorService
        const result = await this.executorService.execute(executorPrompt, modelId);
        taskUsage = result.usage;

        // Parse findings from executor output
        const findings = parseFindings(result.resultText);

        // Complete the task in storage
        storage.completeTask(planId, task.task_id, findings, taskUsage);

        completedCount++;
        totalFindings += findings.length;

        pushEvent({
          type: "task_completed",
          taskId: task.task_id,
          reviewId: task.review_id,
          files: task.files,
          findingCount: findings.length,
          usage: taskUsage,
        });

        pushEvent({
          type: "batch_progress",
          completed: completedCount,
          total,
        });
      } catch (error) {
        completedCount++;

        // Mark the task as errored (preserves the distinction from "complete with 0 findings")
        try {
          storage.errorTask(planId, task.task_id, error instanceof Error ? error.message : String(error), taskUsage);
        } catch {
          // Storage error on top of executor error — just report
        }

        pushEvent({
          type: "task_error",
          taskId: task.task_id,
          reviewId: task.review_id,
          files: task.files,
          error: error instanceof Error ? error.message : String(error),
        });

        pushEvent({
          type: "batch_progress",
          completed: completedCount,
          total,
        });
      }
    };

    // Concurrency pool
    const pool: Promise<void>[] = [];
    let taskIndex = 0;

    // Start initial batch
    while (taskIndex < pendingTasks.length && pool.length < maxConcurrent) {
      const task = pendingTasks[taskIndex]!;
      taskIndex++;
      const p = runExecutor(task).then(() => {
        pool.splice(pool.indexOf(p), 1);
      });
      pool.push(p);
    }

    // Process events and spawn new tasks as slots free up
    while (completedCount < total) {
      // Yield any queued events
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      // If still tasks to process, wait for a slot to free up
      if (pool.length > 0) {
        await new Promise<void>((resolve) => {
          resolveWaiting = resolve;
          // Also resolve when a pool item completes (in case no events are pushed)
          if (eventQueue.length > 0) {
            resolve();
            resolveWaiting = null;
          } else {
            // Set a timeout to check periodically (prevents deadlock)
            const interval = setInterval(() => {
              if (eventQueue.length > 0 || completedCount >= total) {
                clearInterval(interval);
                resolve();
                resolveWaiting = null;
              }
            }, 100);
          }
        });

        // Spawn more tasks if slots available
        while (taskIndex < pendingTasks.length && pool.length < maxConcurrent) {
          const task = pendingTasks[taskIndex]!;
          taskIndex++;
          const p = runExecutor(task).then(() => {
            pool.splice(pool.indexOf(p), 1);
          });
          pool.push(p);
        }
      }
    }

    // Yield any remaining events
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    // Final completion event
    yield { type: "complete", totalFindings };
  }
}
