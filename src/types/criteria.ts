// =============================================================================
// Criterion Types (parsed from criterion markdown files)
// =============================================================================

/** Claude model tier used for agent execution. */
export type AgentModel = "haiku" | "sonnet" | "opus";

/** A criterion parsed from a markdown file in the criteria directory. */
export interface ReviewModule {
  /** Unique identifier, e.g. "architecture/dto-enforcement". */
  id: string;
  /** Relative file path, e.g. "deskcheck/criteria/architecture/dto-enforcement.md". */
  file: string;
  /** Human-readable description from frontmatter. */
  description: string;
  /** File glob patterns that determine which files this criterion checks. */
  globs: string[];
  /** Natural language instruction for how to split matched files into subtasks. */
  partition: string;
  /** Claude model tier to use for executor agents. */
  model: AgentModel;
  /**
   * Extra tool names to make available to reviewers running this criterion,
   * layered on top of the built-in reviewer tools and config-level tools.
   * Empty by default.
   */
  tools: string[];
  /** The detective prompt (markdown body of the criterion) given to executor agents. */
  prompt: string;
}
