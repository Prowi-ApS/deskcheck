import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildPartitionerPrompt } from "../../prompts/PartitionerPrompt.js";
import type { ReviewConfig } from "../../config/types.js";
import type { AgentModel, ReviewModule } from "../../types/criteria.js";
import type {
  PartitionedSubtask,
  Scope,
  TaskUsage,
} from "../../types/review.js";

// =============================================================================
// Types
// =============================================================================

/** What the partitioner agent produces for one criterion. */
export interface PartitionResult {
  reasoning: string;
  subtasks: PartitionedSubtask[];
  /** Claude model tier used for this partitioner run. */
  model: AgentModel;
  usage: TaskUsage | null;
  /** Full SDK message stream from this run, for transcript persistence. */
  messages: unknown[];
}

// =============================================================================
// Errors
// =============================================================================

/** Thrown when the partitioner agent fails or produces invalid output. */
export class PartitionerError extends Error {
  /** The criterion id this failure was scoped to. */
  readonly reviewId: string;

  constructor(reviewId: string, message: string) {
    super(`Partitioner failed for criterion "${reviewId}": ${message}`);
    this.name = "PartitionerError";
    this.reviewId = reviewId;
  }
}

// =============================================================================
// ReviewPartitionerService
// =============================================================================

/**
 * Spawns one fresh Claude agent per criterion to decide how to split the
 * matched files into reviewer subtasks. The agent reads the criterion's
 * `partition` instruction (natural language) and uses built-in tools
 * (Read, Grep, Glob, Bash) to inspect files when grouping requires it.
 *
 * Output is delivered via an in-process MCP tool `submit_partition`. If the
 * agent never calls the tool, or calls it with invalid output (e.g. drops a
 * file), this service throws — partitioner failures fail the whole run.
 */
export class ReviewPartitionerService {
  private readonly config: ReviewConfig;
  private readonly projectRoot: string;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  /**
   * Run the partitioner for one criterion. Returns the validated partition
   * result, or throws on failure.
   */
  async partition(
    criterion: ReviewModule,
    matchedFiles: string[],
    scope: Scope,
  ): Promise<PartitionResult> {
    if (matchedFiles.length === 0) {
      throw new PartitionerError(criterion.id, "matchedFiles is empty");
    }

    interface CapturedPartition {
      reasoning: string;
      subtasks: PartitionedSubtask[];
    }
    let captured: CapturedPartition | null = null;
    let captureError: string | null = null;
    const inputFileSet = new Set(matchedFiles);

    // In-process MCP tool the partitioner agent calls to deliver its output.
    const partitionerServer = createSdkMcpServer({
      name: "deskcheck-partitioner",
      version: "0.1.0",
      tools: [
        tool(
          "submit_partition",
          "Submit the final partition for this criterion. Call exactly once.",
          {
            reasoning: z
              .string()
              .describe("Short overall explanation of how you split the files."),
            subtasks: z
              .array(
                z.object({
                  files: z
                    .array(z.string())
                    .describe("Files assigned to this subtask. At least one."),
                  focus: z
                    .string()
                    .nullable()
                    .optional()
                    .describe(
                      "Optional sub-file narrowing (method name, class name, region). Null if the whole file is the unit.",
                    ),
                  hint: z
                    .string()
                    .nullable()
                    .optional()
                    .describe("One short sentence explaining why these files belong together."),
                }),
              )
              .min(1)
              .describe("Non-empty list of subtasks."),
          },
          async (args) => {
            // Validate locally so we can return a useful error to the agent
            // (and abort with a clear message if it never recovers).
            const normalized: PartitionedSubtask[] = args.subtasks.map((s) => ({
              files: s.files,
              focus: s.focus ?? null,
              hint: s.hint ?? null,
            }));

            const validationError = validatePartition(normalized, inputFileSet);
            if (validationError) {
              captureError = validationError;
              return {
                content: [{
                  type: "text" as const,
                  text: `Error: ${validationError}. Please call submit_partition again with a corrected partition.`,
                }],
                isError: true,
              };
            }

            captured = { reasoning: args.reasoning, subtasks: normalized };
            captureError = null;

            return {
              content: [{
                type: "text" as const,
                text: `Accepted: ${normalized.length} subtask(s).`,
              }],
            };
          },
        ),
      ],
    });

    const partitionerModel = this.config.agents.partitioner.model ?? this.config.defaultModel;
    const systemPrompt = buildPartitionerPrompt(criterion, matchedFiles, scope);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 5 * 60 * 1000);

    let usage: TaskUsage | null = null;
    const messages: unknown[] = [];

    try {
      for await (const message of query({
        prompt: `Partition the files for criterion ${criterion.id}.`,
        options: {
          model: partitionerModel,
          systemPrompt,
          tools: [
            "Read",
            "Grep",
            "Glob",
            "Bash",
            "mcp__deskcheck-partitioner__*",
          ],
          permissionMode: "bypassPermissions",
          maxTurns: 15,
          cwd: this.projectRoot,
          persistSession: false,
          abortController,
          mcpServers: {
            "deskcheck-partitioner": partitionerServer,
          },
        },
      })) {
        messages.push(message);
        if (message.type === "result") {
          const msg = message as Record<string, unknown>;
          const u = msg.usage as Record<string, number> | undefined;
          usage = {
            input_tokens: u?.input_tokens ?? 0,
            output_tokens: u?.output_tokens ?? 0,
            cache_read_tokens: u?.cache_read_input_tokens ?? 0,
            cache_creation_tokens: u?.cache_creation_input_tokens ?? 0,
            cost_usd: (msg.total_cost_usd as number) ?? 0,
            duration_ms: (msg.duration_ms as number) ?? 0,
            duration_api_ms: (msg.duration_api_ms as number) ?? 0,
            num_turns: (msg.num_turns as number) ?? 0,
            model: partitionerModel,
          };

          if (message.subtype !== "success") {
            throw new PartitionerError(
              criterion.id,
              `agent ended with subtype "${message.subtype}"`,
            );
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    // TS narrows `captured` to `never` because all assignments happen inside
    // the MCP tool handler closure — control-flow analysis doesn't follow
    // those. Cast through unknown to read the runtime value.
    const finalCaptured = captured as unknown as CapturedPartition | null;
    if (!finalCaptured) {
      const detail = captureError
        ? `agent never produced a valid partition. Last validation error: ${captureError}`
        : "agent did not call submit_partition";
      throw new PartitionerError(criterion.id, detail);
    }

    return {
      reasoning: finalCaptured.reasoning,
      subtasks: finalCaptured.subtasks,
      model: partitionerModel,
      usage,
      messages,
    };
  }
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Verify a candidate partition covers every input file at least once and
 * has well-formed subtasks. Returns a human-readable error string or null
 * if the partition is valid.
 */
export function validatePartition(
  subtasks: PartitionedSubtask[],
  inputFiles: Set<string>,
): string | null {
  if (subtasks.length === 0) {
    return "subtasks must be non-empty";
  }

  const seen = new Set<string>();
  for (let i = 0; i < subtasks.length; i++) {
    const sub = subtasks[i]!;
    if (!Array.isArray(sub.files) || sub.files.length === 0) {
      return `subtask ${i} has no files`;
    }
    for (const file of sub.files) {
      if (!inputFiles.has(file)) {
        return `subtask ${i} references file "${file}" which is not in the input list`;
      }
      seen.add(file);
    }
  }

  const missing = [...inputFiles].filter((f) => !seen.has(f));
  if (missing.length > 0) {
    return `${missing.length} input file(s) missing from partition: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`;
  }

  return null;
}
