import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig as SdkMcpServerConfig, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ReviewConfig } from "../config/types.js";
import type { AgentModel } from "../types/criteria.js";
import type { TaskUsage } from "../types/review.js";

// =============================================================================
// Types
// =============================================================================

/** The result returned by ExecutorService.execute(). */
export interface ExecutorResult {
  resultText: string;
  usage: TaskUsage | null;
  /** Full SDK message stream from this run, for transcript persistence. */
  messages: unknown[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build the merged MCP servers map for an executor agent.
 *
 * Combines shared MCP servers from config with any additional servers
 * defined for the executor role.
 */
export function buildMcpServers(config: ReviewConfig): Record<string, SdkMcpServerConfig> {
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
 * Tools always available to a reviewer regardless of config. Reviewers need
 * these to fetch their own context (Read/Grep/Glob for full files, Bash for
 * `git diff` in changes-mode scope), so they're hard-wired into the pipeline
 * rather than being user-configurable.
 */
export const BUILTIN_REVIEWER_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "Bash",
];

/**
 * Build the merged allowed tools list for an executor agent.
 *
 * Always includes the built-in reviewer tools (so reviewers can fetch their
 * own context), then layers config-shared tools and executor-role tools on
 * top, deduplicated.
 */
export function buildAllowedTools(config: ReviewConfig): string[] {
  const tools: string[] = [...BUILTIN_REVIEWER_TOOLS];

  for (const tool of config.shared.allowed_tools) {
    if (!tools.includes(tool)) {
      tools.push(tool);
    }
  }

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
// ExecutorService
// =============================================================================

/**
 * Spawns a single executor agent via the Claude Agent SDK and returns
 * the result text and usage data.
 *
 * Encapsulates the query() call, AbortController timeout, MCP server
 * merging, and tool merging so callers don't need to know these details.
 */
export class ExecutorService {
  private readonly config: ReviewConfig;
  private readonly projectRoot: string;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  /**
   * Execute an agent with the given prompt and model.
   *
   * @param prompt - The system prompt for the executor agent.
   * @param model - The Claude model tier to use.
   * @param options - Optional overrides for tools, MCP servers, max turns, timeout, and permission mode.
   *   - `tools` fully overrides the computed allowed-tool set; use this only when callers want
   *     to bypass the built-in/config/criterion layering.
   *   - `extraTools` are layered on top of the normal computed set. This is the right knob for
   *     per-criterion tools coming from frontmatter.
   * @returns The result text and usage data from the agent run.
   */
  async execute(prompt: string, model: AgentModel, options?: {
    maxTurns?: number;
    timeoutMs?: number;
    tools?: string[];
    extraTools?: string[];
    mcpServers?: Record<string, SdkMcpServerConfig>;
    permissionMode?: PermissionMode;
  }): Promise<ExecutorResult> {
    let allowedTools = options?.tools ?? buildAllowedTools(this.config);
    if (options?.extraTools && options.extraTools.length > 0) {
      const merged = [...allowedTools];
      for (const t of options.extraTools) {
        if (!merged.includes(t)) merged.push(t);
      }
      allowedTools = merged;
    }
    const mcpServers = options?.mcpServers ?? buildMcpServers(this.config);
    const maxTurns = options?.maxTurns ?? 25;
    const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000;
    const permissionMode: PermissionMode = options?.permissionMode ?? "dontAsk";

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    let resultText = "";
    let taskUsage: TaskUsage | null = null;
    const messages: unknown[] = [];

    try {
      for await (const message of query({
        prompt,
        options: {
          model,
          tools: allowedTools,
          permissionMode,
          maxTurns,
          cwd: this.projectRoot,
          persistSession: false,
          abortController,
          ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        },
      })) {
        messages.push(message);
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
            model,
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

    return { resultText, usage: taskUsage, messages };
  }
}
