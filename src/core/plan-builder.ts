import { findMatchingModules } from "./glob-matcher.js";
import { ReviewStorage } from "./storage.js";
import type {
  ModuleSummary,
  ReviewModule,
  ReviewPlan,
  ReviewSource,
} from "./types.js";

/**
 * Build a complete review plan: create the plan, match files to modules,
 * generate tasks, and finalize.
 *
 * This is the single authoritative implementation of plan+task creation,
 * shared by both the planner agent's in-process MCP tool and any other
 * entry point that needs to create a plan from a file list.
 */
export function buildPlanWithTasks(
  storage: ReviewStorage,
  name: string,
  source: ReviewSource,
  files: string[],
  modules: ReviewModule[],
): ReviewPlan {
  // Create the plan shell
  const plan = storage.createPlan(name, source);

  // Match files against criteria
  const matches = findMatchingModules(files, modules);

  // Track coverage
  const matchedFileSet = new Set<string>();
  for (const match of matches) {
    for (const file of match.matchedFiles) {
      matchedFileSet.add(file);
    }
  }
  const matchedFiles = [...matchedFileSet].sort();
  const unmatchedFiles = files.filter((f) => !matchedFileSet.has(f)).sort();
  storage.setMatchedFiles(plan.plan_id, matchedFiles, unmatchedFiles);

  // Set module summaries
  const moduleSummaries: Record<string, ModuleSummary> = {};
  for (const match of matches) {
    moduleSummaries[match.module.id] = {
      review_id: match.module.id,
      description: match.module.description,
      severity: match.module.severity,
      model: match.module.model,
      task_count: 0,
      matched_files: match.matchedFiles,
    };
  }
  storage.setModules(plan.plan_id, moduleSummaries);

  // Create tasks based on module mode
  for (const match of matches) {
    const isGrouped =
      match.module.mode.toLowerCase().includes("grouped") ||
      match.module.mode.toLowerCase().includes("all files");

    if (isGrouped) {
      storage.addTask(plan.plan_id, {
        review_id: match.module.id,
        review_file: match.module.file,
        files: match.matchedFiles,
        hint: null,
        model: match.module.model,
      });
    } else {
      for (const file of match.matchedFiles) {
        storage.addTask(plan.plan_id, {
          review_id: match.module.id,
          review_file: match.module.file,
          files: [file],
          hint: null,
          model: match.module.model,
        });
      }
    }
  }

  // Finalize the plan (sets status to "ready", recounts tasks per module)
  return storage.finalizePlan(plan.plan_id);
}
