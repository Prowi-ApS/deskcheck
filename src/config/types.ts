import type { AgentEffort, AgentModel } from "../types/criteria.js";

// =============================================================================
// Config Types (.deskcheck/config.json)
// =============================================================================

/** MCP server configuration for agent tool access. */
export interface McpServerConfig {
  /** Command to start the MCP server. */
  command: string;
  /** Command-line arguments. */
  args?: string[];
  /** Environment variables passed to the server process. */
  env?: Record<string, string>;
}

/** Per-role agent configuration. */
export interface AgentRoleConfig {
  /** Override the default model for this role. */
  model?: AgentModel;
  /** Override the effort level for this role. */
  effort?: AgentEffort;
  /** Additional tools beyond the shared set. */
  additional_tools?: string[];
  /** Additional MCP servers beyond the shared set. */
  additional_mcp_servers?: Record<string, McpServerConfig>;
}

/** Top-level deskcheck tool configuration from .deskcheck/config.json. */
export interface ReviewConfig {
  /** Directory containing criterion markdown files. */
  modules_dir: string;
  /** Directory for storing deskcheck run results. */
  storage_dir: string;
  /** Directory for storing test files. */
  tests_dir: string;
  /** Port for the web UI server. Default: 3000. */
  serve_port: number;
  /** Max concurrent reviewer agents. Default: 5. */
  concurrency: number;
  /**
   * Default Claude model used across the pipeline. Applied to:
   * - Criterion `model` when not specified in frontmatter
   * - Resolver agent (unless `agents.resolver.model` overrides)
   * - Partitioner agent (unless `agents.partitioner.model` overrides)
   *
   * Individual agents and criteria can always override this.
   */
  defaultModel: AgentModel;
  /** Shared configuration applied to all agent roles. */
  shared: {
    /** Tools available to all agents. */
    allowed_tools: string[];
    /** MCP servers available to all agents. */
    mcp_servers: Record<string, McpServerConfig>;
  };
  /** Per-role agent configuration. */
  agents: {
    resolver: AgentRoleConfig;
    partitioner: AgentRoleConfig;
    reviewer: AgentRoleConfig;
    evaluator: AgentRoleConfig;
    judge: AgentRoleConfig;
  };
}
