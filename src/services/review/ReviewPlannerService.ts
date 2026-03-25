import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { discoverModules, filterModules } from "../criteria/module-parser.js";
import { buildPlanWithTasks } from "./ReviewPlanBuilderService.js";
import { ReviewStorageService } from "./ReviewStorageService.js";
import { buildPlannerPrompt } from "../../prompts/PlannerPrompt.js";
import type { ReviewConfig } from "../../config/types.js";
import type { ReviewPlan } from "../../types/review.js";

/**
 * Plans review tasks by delegating intent detection to an Agent SDK agent.
 *
 * Instead of parsing user intent with regex heuristics, the planner spawns
 * a Claude agent that has access to git, the filesystem, and review planning
 * tools. The agent interprets what the user wants to review and creates the
 * plan accordingly.
 */
export class ReviewPlannerService {
  private readonly config: ReviewConfig;
  private readonly projectRoot: string;

  constructor(config: ReviewConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  /**
   * Create a review plan from natural language input.
   *
   * Spawns a planner agent that:
   * 1. Interprets the user's intent (what files/branch/symbol to review)
   * 2. Uses git/filesystem to get the list of files
   * 3. Calls the planning MCP tools to create the plan
   *
   * The planner agent has access to an in-process MCP server with tools
   * for creating plans and tasks, plus standard git/read tools for
   * discovering what to review.
   */
  async plan(input: string, criteriaFilter?: string[]): Promise<ReviewPlan> {
    const storageDir = path.resolve(this.projectRoot, this.config.storage_dir);
    const storage = new ReviewStorageService(storageDir);
    const modulesDir = path.resolve(this.projectRoot, this.config.modules_dir);
    let modules = discoverModules(modulesDir);

    if (criteriaFilter && criteriaFilter.length > 0) {
      modules = filterModules(modules, criteriaFilter);
    }

    // Build the module summary for the agent's context
    const moduleDescriptions = modules.map((m) =>
      `- ${m.id} (severity: ${m.severity}, model: ${m.model})\n  Globs: ${m.globs.join(", ")}\n  Mode: ${m.mode}`
    ).join("\n");

    // Track the plan ID created by the agent
    let createdPlanId: string | null = null;

    // Create an in-process MCP server with planning tools
    const plannerServer = createSdkMcpServer({
      name: "deskcheck-planner",
      version: "0.1.0",
      tools: [
        tool(
          "create_plan",
          "Create a review plan and tasks. Call this once you know what files to review.",
          {
            name: z.string().describe("Human-readable name for this review, e.g. 'changes against develop' or 'full review: Commission.php'"),
            source_type: z.enum(["diff", "file", "symbol"]).describe("Type of review: diff (branch comparison), file (full file), symbol (specific function/method)"),
            source_target: z.string().describe("The target: branch name for diff, file path for file, symbol name for symbol"),
            source_file: z.string().optional().describe("For symbol mode only: the file containing the symbol"),
            files: z.array(z.string()).describe("List of file paths to review"),
          },
          async (args) => {
            const source = {
              type: args.source_type,
              target: args.source_target,
              ...(args.source_file ? { file: args.source_file } : {}),
            };

            const finalPlan = buildPlanWithTasks(storage, args.name, source, args.files, modules);
            createdPlanId = finalPlan.plan_id;

            const taskCount = Object.keys(finalPlan.tasks).length;
            const moduleCount = Object.keys(finalPlan.modules).length;

            return {
              content: [{
                type: "text" as const,
                text: `Plan created: ${finalPlan.plan_id}\n${taskCount} tasks across ${moduleCount} modules\n${finalPlan.matched_files.length} files matched, ${finalPlan.unmatched_files.length} not covered`,
              }],
            };
          },
        ),
      ],
    });

    // Build planner model — use short names (haiku/sonnet/opus)
    // The Agent SDK resolves these to full model IDs internally
    const plannerModel = this.config.agents.planner.model ?? "haiku";

    const systemPrompt = buildPlannerPrompt(moduleDescriptions);

    // Spawn the planner agent with a 5-minute timeout
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 5 * 60 * 1000);

    try {
      for await (const message of query({
        prompt: input,
        options: {
          model: plannerModel,
          systemPrompt,
          tools: [
            "Bash",
            "Read",
            "Glob",
            "Grep",
            "mcp__deskcheck-planner__*",
          ],
          permissionMode: "bypassPermissions",
          maxTurns: 15,
          cwd: this.projectRoot,
          persistSession: false,
          abortController,
          mcpServers: {
            "deskcheck-planner": plannerServer,
          },
        },
      })) {
        if (message.type === "result" && message.subtype !== "success") {
          throw new Error(`Planner agent failed: ${JSON.stringify(message)}`);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!createdPlanId) {
      throw new Error("Planner agent did not create a plan. It may not have understood the request.");
    }

    return storage.getPlan(createdPlanId);
  }
}
