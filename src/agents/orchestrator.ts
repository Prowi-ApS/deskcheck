import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig as SdkMcpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { ReviewStorage } from "../core/storage.js";
import { extractContext } from "../core/context-extractor.js";
import { buildExecutorPrompt } from "./executor-prompt.js";
import { parseFindings } from "../services/FindingsParserService.js";
import type { ReviewConfig } from "../config/types.js";
import type {
  ReviewTask,
  TaskUsage,
} from "../types/review.js";

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
// Helpers
// =============================================================================

/**
 * Build the merged MCP servers map for an executor agent.
 *
 * Combines shared MCP servers from config with any additional servers
 * defined for the executor role.
 */
function buildMcpServers(config: ReviewConfig): Record<string, SdkMcpServerConfig> {
  const servers: Record<string, SdkMcpServerConfig> = {};

  // Add shared servers
  for (const [name, serverConfig] of Object.entries(config.shared.mcp_servers)) {
    servers[name] = {
      type: "stdio",
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
    };
  }

  // Add executor-specific additional servers
  const executorServers = config.agents.executor.additional_mcp_servers;
  if (executorServers) {
    for (const [name, serverConfig] of Object.entries(executorServers)) {
      servers[name] = {
        type: "stdio",
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      };
    }
  }

  return servers;
}

/**
 * Build the merged allowed tools list for an executor agent.
 *
 * Combines shared tools from config with any additional tools defined
 * for the executor role.
 */
function buildAllowedTools(config: ReviewConfig): string[] {
  const tools = [...config.shared.allowed_tools];

  const executorTools = config.agents.executor.additional_tools;
  if (executorTools) {
    for (const tool of executorTools) {
      if (!tools.includes(tool)) {
        tools.push(tool);
      }
    }
  }

  return tools;
}

// =============================================================================
// ReviewOrchestrator
// =============================================================================

/**
 * Executes a review plan by dispatching tasks to executor agents via the
 * Claude Agent SDK and collecting their findings.
 *
 * Uses an async generator to yield progress events, allowing callers to
 * react to task starts, completions, errors, and overall progress in real time.
 */
export class ReviewOrchestrator {
  private readonly config: ReviewConfig;
  private readonly projectRoot: string;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
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
    const storage = new ReviewStorage(storageDir);

    const plan = storage.getPlan(planId);
    const pendingTasks = storage.getPendingTasks(planId);

    if (pendingTasks.length === 0) {
      yield { type: "complete", totalFindings: 0 };
      return;
    }

    const allowedTools = buildAllowedTools(this.config);
    const mcpServers = buildMcpServers(this.config);

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

        // Spawn executor agent via Claude Agent SDK with a 5-minute timeout
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 5 * 60 * 1000);

        let resultText = "";
        try {
          for await (const message of query({
            prompt: executorPrompt,
            options: {
              model: modelId,
              tools: allowedTools,
              permissionMode: "dontAsk",
              maxTurns: 25,
              cwd: this.projectRoot,
              persistSession: false,
              abortController,
              ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
            },
          })) {
            if (message.type === "result") {
              // Capture usage data from result (available on both success and error)
              const msg = message as Record<string, unknown>;
              const usage = msg.usage as Record<string, number> | undefined;
              taskUsage = {
                input_tokens: usage?.input_tokens ?? 0,
                output_tokens: usage?.output_tokens ?? 0,
                cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
                cache_creation_tokens: usage?.cache_creation_input_tokens ?? 0,
                cost_usd: (msg.total_cost_usd as number) ?? 0,
                duration_ms: (msg.duration_ms as number) ?? 0,
                duration_api_ms: (msg.duration_api_ms as number) ?? 0,
                num_turns: (msg.num_turns as number) ?? 0,
                model: modelId,
              };

              if (message.subtype === "success") {
                resultText = message.result;
              } else {
                throw new Error(`Executor failed: ${message.errors.join(", ")}`);
              }
            }
          }
        } finally {
          clearTimeout(timeout);
        }

        // Parse findings from executor output
        const findings = parseFindings(resultText);

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
