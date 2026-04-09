import type { AgentModel } from "../types/criteria.js";

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

/** Per-role agent configuration (planner, executor, evaluator). */
export interface AgentRoleConfig {
  /** Override the default model for this role. */
  model?: AgentModel;
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
    executor: AgentRoleConfig;
    evaluator: AgentRoleConfig;
    judge: AgentRoleConfig;
  };
}
