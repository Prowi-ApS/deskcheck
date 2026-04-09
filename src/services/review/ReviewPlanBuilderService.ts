import { findMatchingModules } from "../criteria/glob-matcher.js";
import { ReviewStorageService } from "./ReviewStorageService.js";
import { ReviewPartitionerService, PartitionerError } from "./ReviewPartitionerService.js";
import type { ReviewModule } from "../../types/criteria.js";
import type {
  ModuleSummary,
  PartitionDecision,
  PlanInvocation,
  ReviewPlan,
  Scope,
} from "../../types/review.js";

/**
 * Hooks called as the plan builder progresses through its steps. Used by
 * the CLI to print live status. Optional.
 */
export interface PartitionProgressEvents {
  /** Fires once after glob matching, before partitioning starts. */
  onMatchingComplete?: (matchedCriteria: number, matchedFiles: number) => void;
  /** Fires when each per-criterion partitioner starts. */
  onPartitionStarted?: (reviewId: string, fileCount: number) => void;
  /** Fires when each per-criterion partitioner finishes successfully. */
  onPartitionCompleted?: (decision: PartitionDecision) => void;
}

/**
 * Build a complete review plan: create the plan, glob-match files to
 * criteria, run one partitioner agent per matched criterion to produce
 * subtasks, write everything to storage, and finalize.
 *
 * Partitioners run concurrently with `Promise.all`. ALL partitioners must
 * complete before any tasks are added — this is a deliberate barrier so
 * that downstream reviewers see a fully-partitioned plan and so that the
 * partitioning step can be inspected as a unit (e.g. via `--dry-run`).
 *
 * If any partitioner throws, the error propagates and the plan is left in
 * its pre-finalized state. Per design, partitioner failures fail the run.
 */
export async function buildPlanWithTasks(
  storage: ReviewStorageService,
  partitioner: ReviewPartitionerService,
  name: string,
  scope: Scope,
  invocation: PlanInvocation,
  files: string[],
  modules: ReviewModule[],
  events?: PartitionProgressEvents,
): Promise<ReviewPlan> {
  // Create the plan shell — already at step "matching" by default.
  const plan = storage.createPlan(name, scope, invocation);

  // Match files against criteria (programmatic, no LLM)
  const matches = findMatchingModules(files, modules);
  events?.onMatchingComplete?.(
    matches.length,
    new Set(matches.flatMap((m) => m.matchedFiles)).size,
  );

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
      model: match.module.model,
      partition: match.module.partition,
      task_count: 0,
      matched_files: match.matchedFiles,
    };
  }
  storage.setModules(plan.plan_id, moduleSummaries);

  // ---------------------------------------------------------------------------
  // Partition step — one fresh agent per matched criterion, all in parallel.
  // Must complete entirely before any tasks are added. If anything throws,
  // we stamp the failure on the plan so the UI can render it before
  // re-raising for the CLI to surface.
  // ---------------------------------------------------------------------------

  storage.setStep(plan.plan_id, "partitioning");

  let decisions: PartitionDecision[];
  try {
    decisions = await Promise.all(
      matches.map(async (match): Promise<PartitionDecision> => {
        events?.onPartitionStarted?.(match.module.id, match.matchedFiles.length);
        const result = await partitioner.partition(
          match.module,
          match.matchedFiles,
          scope,
        );

        // Persist the partitioner's full SDK transcript as a side-file.
        try {
          storage.writePartitionerLog(plan.plan_id, match.module.id, result.messages);
        } catch (logErr) {
          console.error(
            `[deskcheck] Warning: failed to write partitioner log for ${match.module.id}: ${logErr instanceof Error ? logErr.message : String(logErr)}`,
          );
        }

        const decision: PartitionDecision = {
          review_id: match.module.id,
          matched_files: match.matchedFiles,
          reasoning: result.reasoning,
          subtasks: result.subtasks,
          completed_at: new Date().toISOString(),
          model: result.model,
          usage: result.usage,
        };
        storage.setPartitionDecision(plan.plan_id, decision);
        events?.onPartitionCompleted?.(decision);
        return decision;
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reviewId = err instanceof PartitionerError ? err.reviewId : null;
    storage.setFailure(plan.plan_id, {
      step: "partitioning",
      review_id: reviewId,
      message,
    });
    throw err;
  }

  // ---------------------------------------------------------------------------
  // Materialize partitioner output as ReviewTasks. We do this after all
  // partitioners finish so storage writes are batched and the plan is never
  // half-partitioned on disk.
  // ---------------------------------------------------------------------------

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const decision = decisions[i]!;
    for (const subtask of decision.subtasks) {
      storage.addTask(plan.plan_id, {
        review_id: match.module.id,
        review_file: match.module.file,
        files: subtask.files,
        focus: subtask.focus,
        hint: subtask.hint,
        model: match.module.model,
        tools: match.module.tools,
        prompt: match.module.prompt,
      });
    }
  }

  // Finalize the plan (sets status to "ready", recounts tasks per module).
  // After finalize, the orchestrator takes over — it flips step to "complete"
  // when all tasks reach a terminal state. We set "reviewing" here as the
  // intermediate so the UI sees the transition immediately on plan load.
  const finalized = storage.finalizePlan(plan.plan_id);
  if (Object.keys(finalized.tasks).length > 0) {
    storage.setStep(plan.plan_id, "reviewing");
  } else {
    // No tasks (no criteria matched, or all partitioners produced empty
    // sets — though the validator forbids the latter). Mark complete.
    storage.setStep(plan.plan_id, "complete");
  }
  return storage.getPlan(plan.plan_id);
}
