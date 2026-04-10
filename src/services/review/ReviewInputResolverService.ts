import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildResolverPrompt } from "../../prompts/ResolverPrompt.js";
import type { ReviewConfig } from "../../config/types.js";
import type { Scope } from "../../types/review.js";

// =============================================================================
// Types
// =============================================================================

/** Output of the resolver agent — what to review and how. */
export interface ResolvedInput {
  scope: Scope;
  files: string[];
}

// =============================================================================
// ReviewInputResolverService
// =============================================================================

/**
 * Translates a natural-language deskcheck request into `{ scope, files }` by
 * running a fresh Claude agent that has filesystem/git tools and an
 * in-process MCP `submit_resolution` tool. The resolver does NOT match
 * criteria, partition, or review — those happen downstream identically to
 * the deterministic `deskcheck diff` path.
 *
 * If the caller already supplied an explicit scope override (`--scope`),
 * pass it via `scopeOverride`. The agent will then only resolve the file
 * list; the override wins regardless of what the agent infers.
 */
export class ReviewInputResolverService {
  private readonly config: ReviewConfig;
  private readonly projectRoot: string;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  async resolve(
    input: string,
    scopeOverride?: Scope,
  ): Promise<ResolvedInput> {
    interface CapturedResolution {
      scope: Scope;
      files: string[];
    }
    let captured: CapturedResolution | null = null;

    const resolverServer = createSdkMcpServer({
      name: "deskcheck-resolver",
      version: "0.1.0",
      tools: [
        tool(
          "submit_resolution",
          "Submit the resolved scope and file list. Call exactly once.",
          {
            scope_type: z
              .enum(["all", "changes"])
              .describe("'all' to review full files, 'changes' to review only the diff against a git ref."),
            scope_ref: z
              .string()
              .optional()
              .describe("For scope_type='changes': the git ref to compare against (branch, commit, or HEAD). Ignored for 'all'."),
            files: z
              .array(z.string())
              .describe("File paths to review. May be empty if no files match the request."),
          },
          async (args) => {
            const inferredScope: Scope =
              args.scope_type === "changes"
                ? { type: "changes", ref: args.scope_ref ?? "HEAD" }
                : { type: "all" };
            captured = {
              scope: scopeOverride ?? inferredScope,
              files: args.files,
            };
            return {
              content: [{
                type: "text" as const,
                text: `Accepted: ${args.files.length} file(s), scope=${JSON.stringify(captured.scope)}`,
              }],
            };
          },
        ),
      ],
    });

    const resolverModel = this.config.agents.resolver.model ?? this.config.defaultModel;
    const resolverEffort = this.config.agents.resolver.effort;
    const systemPrompt =
      buildResolverPrompt() +
      (scopeOverride
        ? `\n\n## Scope override\n\nThe user has explicitly specified \`scope = ${JSON.stringify(scopeOverride)}\`. Do not override it. You only need to resolve the file list.`
        : "");

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 5 * 60 * 1000);

    try {
      for await (const message of query({
        prompt: input,
        options: {
          model: resolverModel,
          ...(resolverEffort ? { effort: resolverEffort } : {}),
          systemPrompt,
          tools: [
            "Bash",
            "Read",
            "Glob",
            "Grep",
            "mcp__deskcheck-resolver__*",
          ],
          permissionMode: "bypassPermissions",
          maxTurns: 15,
          cwd: this.projectRoot,
          persistSession: false,
          abortController,
          mcpServers: {
            "deskcheck-resolver": resolverServer,
          },
        },
      })) {
        if (message.type === "result" && message.subtype !== "success") {
          throw new Error(`Resolver agent failed: ${JSON.stringify(message)}`);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    // Cast through unknown — see ReviewPartitionerService for why TS narrows
    // closure-assigned vars to never.
    const finalCaptured = captured as unknown as CapturedResolution | null;
    if (!finalCaptured) {
      throw new Error(
        "Resolver agent did not call submit_resolution. The request may not have been understood.",
      );
    }

    return finalCaptured;
  }
}
