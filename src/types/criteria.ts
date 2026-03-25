// =============================================================================
// Criterion Types (parsed from criterion markdown files)
// =============================================================================

/** Severity level assigned to a criterion (how important it is). */
export type ModuleSeverity = "critical" | "high" | "medium" | "low";

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
  /** How important this criterion's findings are. */
  severity: ModuleSeverity;
  /** File glob patterns that determine which files this criterion checks. */
  globs: string[];
  /** Natural language instruction for how to split files into tasks. */
  mode: string;
  /** Claude model tier to use for executor agents. */
  model: AgentModel;
  /** The detective prompt (markdown body of the criterion) given to executor agents. */
  prompt: string;
}
