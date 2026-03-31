import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ReviewConfig, AgentModel, Issue, Reference } from "../core/types.js";
import { ReviewStorage } from "../core/storage.js";
import { extractContext } from "../core/context-extractor.js";
import { discoverModules, parseModule } from "../core/module-parser.js";
import { findMatchingModules } from "../core/glob-matcher.js";

/**
 * Register all review MCP tools on the given server.
 *
 * Each tool wraps core business logic (storage, module discovery, glob matching)
 * and exposes it over the MCP protocol with Zod-validated input schemas.
 */
export function registerReviewTools(
  server: McpServer,
  config: ReviewConfig,
  projectRoot: string,
): void {
  const storage = new ReviewStorage(
    path.resolve(projectRoot, config.storage_dir),
  );
  const modulesDir = path.resolve(projectRoot, config.modules_dir);

  // ---------------------------------------------------------------------------
  // 1. review_status — health check
  // ---------------------------------------------------------------------------

  server.registerTool("review_status", {
    description: "Returns the status of the deskcheck MCP server.",
  }, () => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ status: "ok", version: "0.1.0" }, null, 2),
      }],
    };
  });

  // ---------------------------------------------------------------------------
  // 2. start_review_plan — create a new review plan
  // ---------------------------------------------------------------------------

  server.registerTool("start_review_plan", {
    description:
      "Create a new review plan. Returns the plan object with its generated plan_id.",
    inputSchema: {
      name: z.string().describe("Human-readable name for the review plan"),
      source_type: z
        .enum(["diff", "file", "symbol"])
        .describe("How source content is provided: diff, file, or symbol"),
      source_target: z
        .string()
        .describe(
          "Target identifier: branch/ref for diff, file path for file, symbol name for symbol",
        ),
      source_file: z
        .string()
        .optional()
        .describe("File containing the symbol (only for symbol mode)"),
    },
  }, ({ name, source_type, source_target, source_file }) => {
    try {
      const plan = storage.createPlan(name, {
        type: source_type,
        target: source_target,
        file: source_file,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 3. get_review_files_matching_paths — discover modules matching files
  // ---------------------------------------------------------------------------

  server.registerTool("get_review_files_matching_paths", {
    description:
      "Discover which criteria match a set of file paths. Returns matches without the full prompt body.",
    inputSchema: {
      files: z
        .array(z.string())
        .describe("Array of file paths to match against criterion globs"),
    },
  }, ({ files }) => {
    try {
      const modules = discoverModules(modulesDir);
      const matches = findMatchingModules(files, modules);

      const result = matches.map((match) => ({
        review_id: match.module.id,
        review_file: match.module.file,
        description: match.module.description,
        severity: match.module.severity,
        globs: match.module.globs,
        mode: match.module.mode,
        model: match.module.model,
        matched_files: match.matchedFiles,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 4. create_review_task — add a task to a plan
  // ---------------------------------------------------------------------------

  server.registerTool("create_review_task", {
    description:
      "Create a review task within a plan. The task_id is auto-generated from the review_id.",
    inputSchema: {
      plan_id: z.string().describe("The plan ID to add the task to"),
      review_id: z
        .string()
        .describe('Review module identifier, e.g. "architecture/dto-enforcement"'),
      review_file: z
        .string()
        .describe("Relative path to the criterion markdown file"),
      files: z
        .array(z.string())
        .describe("Files assigned to this task"),
      hint: z
        .string()
        .optional()
        .describe("Optional planner hint describing scope or focus area"),
      model: z
        .enum(["haiku", "sonnet", "opus"])
        .describe("Claude model tier for the executor agent"),
    },
  }, ({ plan_id, review_id, review_file, files, hint, model }) => {
    try {
      const task = storage.addTask(plan_id, {
        review_id,
        review_file,
        files,
        hint: hint ?? null,
        model,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 5. finish_planning — finalize the plan
  // ---------------------------------------------------------------------------

  server.registerTool("finish_planning", {
    description:
      'Finalize a review plan, setting its status to "ready" for execution.',
    inputSchema: {
      plan_id: z.string().describe("The plan ID to finalize"),
    },
  }, ({ plan_id }) => {
    try {
      const plan = storage.finalizePlan(plan_id);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 6. get_pending_review_tasks — list tasks ready for execution
  // ---------------------------------------------------------------------------

  server.registerTool("get_pending_review_tasks", {
    description:
      "Return tasks eligible for execution: pending tasks and stale in_progress tasks (older than 5 minutes).",
    inputSchema: {
      plan_id: z.string().describe("The plan ID to query"),
    },
  }, ({ plan_id }) => {
    try {
      const tasks = storage.getPendingTasks(plan_id);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 7. start_review — claim a task and return context for executor
  // ---------------------------------------------------------------------------

  server.registerTool("start_review", {
    description:
      "Claim a review task and return everything the executor needs: context (diff/file/symbol content), the criterion prompt, and task metadata.",
    inputSchema: {
      plan_id: z.string().describe("The plan ID"),
      task_id: z.string().describe("The task ID to claim"),
    },
  }, ({ plan_id, task_id }) => {
    try {
      const plan = storage.getPlan(plan_id);
      const task = plan.tasks[task_id];

      if (!task) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: Task "${task_id}" not found in plan "${plan_id}"`,
          }],
          isError: true,
        };
      }

      // Extract context based on source type
      const symbol = plan.source.type === "symbol" ? plan.source.target : undefined;
      const extracted = extractContext(
        plan.source.type,
        plan.source.target,
        task.files,
        projectRoot,
        symbol,
      );

      // Read the criterion prompt
      const moduleFilePath = path.resolve(projectRoot, task.review_file);
      const reviewModule = parseModule(
        moduleFilePath,
        path.resolve(projectRoot, config.modules_dir),
      );

      // Claim the task via storage
      const claimedTask = storage.claimTask(plan_id, task_id, {
        contextType: extracted.contextType,
        content: extracted.content,
        symbol: extracted.symbol ?? undefined,
        prompt: reviewModule.prompt,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            task_id: claimedTask.task_id,
            review_id: claimedTask.review_id,
            files: claimedTask.files,
            hint: claimedTask.hint,
            model: claimedTask.model,
            context_type: claimedTask.context_type,
            context: claimedTask.context,
            symbol: claimedTask.symbol,
            prompt: claimedTask.prompt,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 8. finish_review — complete a task with findings
  // ---------------------------------------------------------------------------

  server.registerTool("finish_review", {
    description:
      "Complete a review task by submitting issues. Updates both plan.json and results.json.",
    inputSchema: {
      plan_id: z.string().describe("The plan ID"),
      task_id: z.string().describe("The task ID to complete"),
      issues: z
        .array(
          z.object({
            severity: z
              .enum(["critical", "warning", "info"])
              .describe("Issue severity"),
            description: z.string().describe("Description of the issue"),
            suggestion: z
              .string()
              .nullable()
              .optional()
              .describe("High-level suggested fix, if applicable"),
            references: z
              .array(
                z.object({
                  file: z.string().describe("File path"),
                  symbol: z.string().nullable().optional().describe("Semantic symbol anchor, e.g. ClassName::method"),
                  line: z.number().nullable().optional().describe("Line number for navigation"),
                  code: z.string().nullable().optional().describe("Current code snippet"),
                  suggestedCode: z.string().nullable().optional().describe("Suggested replacement code"),
                  note: z.string().nullable().optional().describe("Why this reference is relevant"),
                }),
              )
              .describe("Code locations where the issue manifests"),
          }),
        )
        .describe("Array of issues from the review"),
    },
  }, ({ plan_id, task_id, issues }) => {
    try {
      const normalizedIssues: Issue[] = issues.map((i) => ({
        severity: i.severity,
        description: i.description,
        suggestion: i.suggestion ?? null,
        references: i.references.map((r): Reference => ({
          file: r.file,
          symbol: r.symbol ?? null,
          line: r.line ?? null,
          code: r.code ?? null,
          suggestedCode: r.suggestedCode ?? null,
          note: r.note ?? null,
        })),
      }));

      storage.completeTask(plan_id, task_id, normalizedIssues);

      const plan = storage.getPlan(plan_id);
      const task = plan.tasks[task_id];

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            task_id: task.task_id,
            status: task.status,
            completed_at: task.completed_at,
            issues_count: normalizedIssues.length,
            plan_status: plan.status,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 9. get_review_results — aggregated results
  // ---------------------------------------------------------------------------

  server.registerTool("get_review_results", {
    description:
      "Return aggregated review results including findings grouped by file and module.",
    inputSchema: {
      plan_id: z.string().describe("The plan ID to get results for"),
    },
  }, ({ plan_id }) => {
    try {
      const results = storage.getResults(plan_id);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });
}
