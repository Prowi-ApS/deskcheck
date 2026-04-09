/**
 * Seed deskcheck fixtures for UI development.
 *
 * Writes a handful of synthetic plans to .deskcheck/runs/ that exercise
 * every UI state — complete-with-issues, in-progress, failed, clean, and
 * empty. Uses ReviewStorageService methods where it can (so the schemas
 * stay in lockstep with production), and bypasses createPlan only to give
 * fixtures predictable plan_ids.
 *
 * Usage:
 *   npm run seed             — append fixtures to .deskcheck/runs/
 *   npm run seed -- --clean  — wipe .deskcheck/runs/ first
 *   npm run seed -- --help
 */
import path from "node:path";
import fs from "node:fs";
import { ReviewStorageService } from "../src/services/review/ReviewStorageService.js";
import type {
  Issue,
  ModuleSummary,
  PartitionDecision,
  PartitionedSubtask,
  PlanFailure,
  PlanInvocation,
  ReviewPlan,
  Scope,
  TaskUsage,
} from "../src/types/review.js";

// =============================================================================
// CLI handling
// =============================================================================

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Seed deskcheck UI fixtures.

Usage:
  npm run seed             Append fixtures to .deskcheck/runs/
  npm run seed -- --clean  Wipe .deskcheck/runs/ first

The seeder writes 5 fixtures designed to exercise every UI state:
  seed-2026-04-01_complete-with-issues  finished run with mixed-severity issues
  seed-2026-04-02_in-progress           live execution view (mid-run)
  seed-2026-04-03_failed-partitioner    partitioner crash, run marked failed
  seed-2026-04-04_clean                 finished run with zero issues
  seed-2026-04-05_empty-no-match        no criteria matched the files
`);
  process.exit(0);
}

const clean = argv.includes("--clean");

const projectRoot = process.cwd();
const storageDir = path.join(projectRoot, ".deskcheck", "runs");

if (clean) {
  console.log(`Wiping ${storageDir}...`);
  fs.rmSync(storageDir, { recursive: true, force: true });
}
fs.mkdirSync(storageDir, { recursive: true });

const storage = new ReviewStorageService(storageDir);

// =============================================================================
// Helpers — bypass createPlan so we can pick our own plan_id
// =============================================================================

interface PlanShell {
  planId: string;
  name: string;
  scope: Scope;
  invocation: PlanInvocation;
  /** Backdated created_at so list ordering reads naturally. */
  createdAt: string;
}

function writeInitialPlan(shell: PlanShell): void {
  const planDir = path.join(storageDir, shell.planId);
  fs.mkdirSync(planDir, { recursive: true });
  const plan: ReviewPlan = {
    plan_id: shell.planId,
    name: shell.name,
    invocation: shell.invocation,
    scope: shell.scope,
    status: "planning",
    step: "matching",
    failure: null,
    created_at: shell.createdAt,
    finalized_at: null,
    started_at: null,
    completed_at: null,
    matched_files: [],
    unmatched_files: [],
    tasks: {},
    modules: {},
    partition_decisions: {},
  };
  fs.writeFileSync(
    path.join(planDir, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
  );
}

function makeUsage(input: number, output: number, costUsd: number, durationMs: number, model: string, numTurns: number): TaskUsage {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: costUsd,
    duration_ms: durationMs,
    duration_api_ms: Math.round(durationMs * 0.85),
    num_turns: numTurns,
    model,
  };
}

function makeModuleSummary(
  reviewId: string,
  description: string,
  partition: string,
  model: "haiku" | "sonnet" | "opus",
  matchedFiles: string[],
): ModuleSummary {
  return {
    review_id: reviewId,
    description,
    model,
    partition,
    task_count: 0,
    matched_files: matchedFiles,
  };
}

function makeDecision(
  reviewId: string,
  matchedFiles: string[],
  reasoning: string,
  subtasks: PartitionedSubtask[],
  model: "haiku" | "sonnet" | "opus",
  usage: TaskUsage,
): PartitionDecision {
  return {
    review_id: reviewId,
    matched_files: matchedFiles,
    reasoning,
    subtasks,
    completed_at: new Date().toISOString(),
    model,
    usage,
  };
}

// =============================================================================
// Shared invocation
// =============================================================================

const INVOCATION: PlanInvocation = {
  command: "deskcheck",
  args: ["diff", "main"],
  cwd: "/home/rasmus/prowi-monorepo",
};

// =============================================================================
// Fixture 1 — complete-with-issues
// =============================================================================

function seedCompleteWithIssues(): void {
  const planId = "seed-2026-04-01_complete-with-issues";
  console.log(`  ${planId}`);

  writeInitialPlan({
    planId,
    name: "feature/order-rework vs main",
    scope: { type: "changes", ref: "main" },
    invocation: INVOCATION,
    createdAt: "2026-04-01T14:30:22Z",
  });

  const matchedFiles = [
    "src/Services/CommissionService.php",
    "src/Services/KpiCalculator.php",
    "src/Services/ApprovalService.php",
    "src/Controllers/CommissionController.php",
    "tests/CommissionServiceTest.php",
  ];

  storage.setMatchedFiles(planId, matchedFiles, [
    "src/Models/Commission.php",
    "src/Events/CommissionCalculated.php",
  ]);

  storage.setModules(planId, {
    "general/error-handling": makeModuleSummary(
      "general/error-handling",
      "Checks for proper error handling patterns",
      "one public method per task",
      "sonnet",
      [
        "src/Services/CommissionService.php",
        "src/Services/KpiCalculator.php",
        "src/Services/ApprovalService.php",
      ],
    ),
    "general/security": makeModuleSummary(
      "general/security",
      "Checks for common security vulnerabilities",
      "one file per task",
      "sonnet",
      [
        "src/Controllers/CommissionController.php",
        "src/Services/ApprovalService.php",
      ],
    ),
    "general/test-coverage": makeModuleSummary(
      "general/test-coverage",
      "Verifies tests cover the public API of changed services",
      "group test files with their corresponding source files",
      "sonnet",
      [
        "tests/CommissionServiceTest.php",
        "src/Services/CommissionService.php",
      ],
    ),
  });

  storage.setStep(planId, "partitioning");

  // -- error-handling: 4 method-focused subtasks on CommissionService + 2 file subtasks --
  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/error-handling",
      [
        "src/Services/CommissionService.php",
        "src/Services/KpiCalculator.php",
        "src/Services/ApprovalService.php",
      ],
      "CommissionService.php has 4 public methods with distinct error paths — split into per-method subtasks. KpiCalculator.php is a small utility, reviewed as one unit. ApprovalService.php has one main entry point, reviewed as one unit.",
      [
        { files: ["src/Services/CommissionService.php"], focus: "calculateCommission method", hint: "Primary calculation entry point with multiple error paths" },
        { files: ["src/Services/CommissionService.php"], focus: "applyTiers method", hint: "Tier application logic with bracket boundaries" },
        { files: ["src/Services/CommissionService.php"], focus: "resolveOverrides method", hint: "Override resolution with fallback chain" },
        { files: ["src/Services/CommissionService.php"], focus: "handleCorrections method", hint: "Correction logic for paid commissions — most error-prone path" },
        { files: ["src/Services/KpiCalculator.php"], focus: null, hint: "Small utility class, single review" },
        { files: ["src/Services/ApprovalService.php"], focus: null, hint: null },
      ],
      "haiku",
      makeUsage(12_400, 1_800, 0.02, 8_200, "haiku", 4),
    ),
  );

  // -- security: 2 file subtasks --
  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/security",
      [
        "src/Controllers/CommissionController.php",
        "src/Services/ApprovalService.php",
      ],
      "Both files reviewed as whole units — security review benefits from full-file context to spot cross-cutting issues.",
      [
        { files: ["src/Controllers/CommissionController.php"], focus: null, hint: "HTTP entry point, watch for input handling" },
        { files: ["src/Services/ApprovalService.php"], focus: null, hint: "Authorization logic" },
      ],
      "haiku",
      makeUsage(8_200, 1_100, 0.01, 5_400, "haiku", 3),
    ),
  );

  // -- test-coverage: 1 grouped subtask --
  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/test-coverage",
      [
        "tests/CommissionServiceTest.php",
        "src/Services/CommissionService.php",
      ],
      "Grouped the test file with its corresponding source file so the reviewer can cross-reference coverage of public methods.",
      [
        {
          files: ["tests/CommissionServiceTest.php", "src/Services/CommissionService.php"],
          focus: null,
          hint: "Cross-reference test against service to verify coverage of all public methods",
        },
      ],
      "haiku",
      makeUsage(6_800, 900, 0.01, 4_100, "haiku", 3),
    ),
  );

  // -- Materialize tasks --
  const ehTasks = [
    { files: ["src/Services/CommissionService.php"], focus: "calculateCommission method", hint: "Primary calculation entry point with multiple error paths" },
    { files: ["src/Services/CommissionService.php"], focus: "applyTiers method", hint: "Tier application logic with bracket boundaries" },
    { files: ["src/Services/CommissionService.php"], focus: "resolveOverrides method", hint: "Override resolution with fallback chain" },
    { files: ["src/Services/CommissionService.php"], focus: "handleCorrections method", hint: "Correction logic for paid commissions — most error-prone path" },
    { files: ["src/Services/KpiCalculator.php"], focus: null, hint: "Small utility class, single review" },
    { files: ["src/Services/ApprovalService.php"], focus: null, hint: null },
  ] as const;
  for (const t of ehTasks) {
    storage.addTask(planId, {
      review_id: "general/error-handling",
      review_file: "deskcheck/criteria/general/error-handling.md",
      files: [...t.files],
      focus: t.focus,
      hint: t.hint,
      model: "sonnet",
      tools: [],
      prompt: "(snipped)",
    });
  }

  storage.addTask(planId, {
    review_id: "general/security",
    review_file: "deskcheck/criteria/general/security.md",
    files: ["src/Controllers/CommissionController.php"],
    focus: null,
    hint: "HTTP entry point, watch for input handling",
    model: "sonnet",
    tools: [],
    prompt: "(snipped)",
  });
  storage.addTask(planId, {
    review_id: "general/security",
    review_file: "deskcheck/criteria/general/security.md",
    files: ["src/Services/ApprovalService.php"],
    focus: null,
    hint: "Authorization logic",
    model: "sonnet",
    tools: [],
    prompt: "(snipped)",
  });

  storage.addTask(planId, {
    review_id: "general/test-coverage",
    review_file: "deskcheck/criteria/general/test-coverage.md",
    files: ["tests/CommissionServiceTest.php", "src/Services/CommissionService.php"],
    focus: null,
    hint: "Cross-reference test against service to verify coverage of all public methods",
    model: "sonnet",
    tools: [],
    prompt: "(snipped)",
  });

  // Stamp started_at via finalize (uses storage's own clock; we override below)
  const finalized = storage.finalizePlan(planId);
  // Backdate started_at via direct write so the elapsed display is realistic
  finalized.started_at = "2026-04-01T14:30:22Z";
  fs.writeFileSync(
    path.join(storageDir, planId, "plan.json"),
    JSON.stringify(finalized, null, 2) + "\n",
  );

  storage.setStep(planId, "reviewing");

  // -- Complete each task with realistic usage and findings --
  const taskOrder = Object.keys(storage.getPlan(planId).tasks);

  // error-handling-001 → calculateCommission, 1 critical issue
  completeTaskFixture(
    planId,
    taskOrder[0]!,
    [
      issue("critical", "calculateCommission silently returns null when the commission plan has no active models. This masks configuration errors and produces incorrect $0 statements that ship to brokers.", "Throw a MissingCommissionModelException instead. The caller can catch and surface this to the user.", [
        ref("src/Services/CommissionService.php", 142, "return null;", "throw new MissingCommissionModelException($plan);", "Silent failure"),
      ]),
    ],
    makeUsage(18_200, 3_400, 0.04, 22_000, "sonnet", 6),
  );

  // error-handling-002 → applyTiers, clean
  completeTaskFixture(planId, taskOrder[1]!, [], makeUsage(15_600, 2_100, 0.03, 18_000, "sonnet", 5));

  // error-handling-003 → resolveOverrides, clean
  completeTaskFixture(planId, taskOrder[2]!, [], makeUsage(14_200, 1_800, 0.03, 16_000, "sonnet", 5));

  // error-handling-004 → handleCorrections, 1 warning
  completeTaskFixture(
    planId,
    taskOrder[3]!,
    [
      issue("warning", "handleCorrections does not validate that the target period is still open before creating a correction entry. A correction against a closed period would silently succeed but never appear in a statement.", "Add a period status check before creating the correction. Throw if the period is already paid.", [
        ref("src/Services/CommissionService.php", 287, null, null, null),
      ]),
    ],
    makeUsage(16_800, 2_800, 0.03, 20_000, "sonnet", 5),
  );

  // error-handling-005 → KpiCalculator, clean
  completeTaskFixture(planId, taskOrder[4]!, [], makeUsage(11_200, 1_200, 0.02, 12_000, "sonnet", 4));

  // error-handling-006 → ApprovalService, clean
  completeTaskFixture(planId, taskOrder[5]!, [], makeUsage(13_400, 1_600, 0.02, 14_000, "sonnet", 4));

  // security-001 → CommissionController, 1 warning + 1 info
  completeTaskFixture(
    planId,
    taskOrder[6]!,
    [
      issue("warning", "CommissionController@store accepts a user_id parameter from the request body without verifying the authenticated user has permission to create commissions for that user. This allows horizontal privilege escalation.", "Add an authorization check: abort_unless($request->user()->can('manage', User::find($request->user_id)))", [
        ref("src/Controllers/CommissionController.php", 45, "$commission = Commission::create($request->all());", "$this->authorize('create', [Commission::class, $request->user_id]);\n$commission = Commission::create($request->validated());", null),
      ]),
      issue("info", "The index action returns all commission records without pagination. For users with many commissions, this could cause performance issues at scale.", "Add ->paginate(50) to the query.", [
        ref("src/Controllers/CommissionController.php", 22, null, null, null),
      ]),
    ],
    makeUsage(19_800, 4_200, 0.05, 25_000, "sonnet", 7),
  );

  // security-002 → ApprovalService, clean
  completeTaskFixture(planId, taskOrder[7]!, [], makeUsage(14_600, 2_000, 0.03, 17_000, "sonnet", 5));

  // test-coverage-001 → multi-reference issue
  completeTaskFixture(
    planId,
    taskOrder[8]!,
    [
      issue("warning", "No test covers the handleCorrections method on CommissionService. This is the most complex mutation path and handles paid-period corrections — a P0 calculation path per the testing policy.", "Add tests for: correction against open period, correction against closed period, correction against paid period (should fail), and correction with churn data.", [
        ref("tests/CommissionServiceTest.php", null, null, null, "No test method references handleCorrections"),
        ref("src/Services/CommissionService.php", 260, null, null, "Method definition under test"),
      ]),
    ],
    makeUsage(22_400, 3_800, 0.05, 28_000, "sonnet", 8),
  );
}

// =============================================================================
// Fixture 2 — in-progress
// =============================================================================

function seedInProgress(): void {
  const planId = "seed-2026-04-02_in-progress";
  console.log(`  ${planId}`);

  writeInitialPlan({
    planId,
    name: "review src/api after refactor",
    scope: { type: "all" },
    invocation: { command: "deskcheck", args: ["review src/api after refactor"], cwd: "/home/rasmus/prowi-monorepo" },
    createdAt: "2026-04-02T11:04:15Z",
  });

  const matchedFiles = [
    "src/api/UsersController.ts",
    "src/api/AuthController.ts",
    "src/api/middleware/auth.ts",
  ];

  storage.setMatchedFiles(planId, matchedFiles, []);
  storage.setModules(planId, {
    "general/error-handling": makeModuleSummary(
      "general/error-handling",
      "Checks for proper error handling patterns",
      "one task per file",
      "haiku",
      matchedFiles,
    ),
    "general/security": makeModuleSummary(
      "general/security",
      "Checks for common security vulnerabilities",
      "one task per file",
      "sonnet",
      matchedFiles,
    ),
  });

  storage.setStep(planId, "partitioning");
  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/error-handling",
      matchedFiles,
      "Three TypeScript files matching the same glob — partition one task per file as the criterion requests.",
      matchedFiles.map((f) => ({ files: [f], focus: null, hint: null })),
      "haiku",
      makeUsage(4_800, 600, 0.005, 3_200, "haiku", 2),
    ),
  );
  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/security",
      matchedFiles,
      "One task per file. Security review needs full-file context.",
      matchedFiles.map((f) => ({ files: [f], focus: null, hint: null })),
      "haiku",
      makeUsage(4_200, 550, 0.004, 2_900, "haiku", 2),
    ),
  );

  for (const f of matchedFiles) {
    storage.addTask(planId, {
      review_id: "general/error-handling",
      review_file: "deskcheck/criteria/general/error-handling.md",
      files: [f],
      focus: null,
      hint: null,
      model: "haiku",
      tools: [],
      prompt: "(snipped)",
    });
  }
  for (const f of matchedFiles) {
    storage.addTask(planId, {
      review_id: "general/security",
      review_file: "deskcheck/criteria/general/security.md",
      files: [f],
      focus: null,
      hint: null,
      model: "sonnet",
      tools: [],
      prompt: "(snipped)",
    });
  }

  storage.finalizePlan(planId);
  storage.setStep(planId, "reviewing");

  // Backdate started_at and the started_at on a couple of tasks
  const plan = storage.getPlan(planId);
  plan.started_at = new Date(Date.now() - 95_000).toISOString();
  fs.writeFileSync(
    path.join(storageDir, planId, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
  );

  const taskIds = Object.keys(storage.getPlan(planId).tasks);

  // error-handling: 1 complete (clean), 1 in_progress, 1 pending
  completeTaskFixture(planId, taskIds[0]!, [], makeUsage(8_400, 900, 0.01, 11_000, "haiku", 3));

  // Mark task 2 as in_progress by claiming it
  storage.claimTask(planId, taskIds[1]!);

  // task[2] stays pending — nothing to do.

  // security: 1 complete (with 1 warning), 1 in_progress, 1 pending
  completeTaskFixture(
    planId,
    taskIds[3]!,
    [
      issue("warning", "UsersController exposes the email field unconditionally on GET /users. PII is leaked even to authenticated non-admin users.", "Use a UserResource transformer that hides email unless the requesting user is an admin or the user themselves.", [
        ref("src/api/UsersController.ts", 38, null, null, null),
      ]),
    ],
    makeUsage(15_600, 2_300, 0.03, 19_000, "sonnet", 5),
  );
  storage.claimTask(planId, taskIds[4]!);

  // Now we need to mark plan as executing — it'll be set on first claim. Verify by reading.
  const final = storage.getPlan(planId);
  // Force step back to reviewing in case any completion path tried to flip it
  final.step = "reviewing";
  final.status = "executing";
  fs.writeFileSync(
    path.join(storageDir, planId, "plan.json"),
    JSON.stringify(final, null, 2) + "\n",
  );
}

// =============================================================================
// Fixture 3 — failed-partitioner
// =============================================================================

function seedFailedPartitioner(): void {
  const planId = "seed-2026-04-03_failed-partitioner";
  console.log(`  ${planId}`);

  writeInitialPlan({
    planId,
    name: "diff develop",
    scope: { type: "changes", ref: "develop" },
    invocation: { command: "deskcheck", args: ["diff", "develop"], cwd: "/home/rasmus/prowi-monorepo" },
    createdAt: "2026-04-03T09:12:00Z",
  });

  const matchedFiles = [
    "src/legacy/PaymentProcessor.php",
    "src/legacy/InvoiceBuilder.php",
  ];

  storage.setMatchedFiles(planId, matchedFiles, []);
  storage.setModules(planId, {
    "general/error-handling": makeModuleSummary(
      "general/error-handling",
      "Checks for proper error handling patterns",
      "one task per file",
      "haiku",
      matchedFiles,
    ),
    "general/security": makeModuleSummary(
      "general/security",
      "Checks for common security vulnerabilities",
      "one method per public class member",
      "sonnet",
      matchedFiles,
    ),
  });

  storage.setStep(planId, "partitioning");

  // error-handling partitioner succeeded
  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/error-handling",
      matchedFiles,
      "Both files reviewed as units.",
      matchedFiles.map((f) => ({ files: [f], focus: null, hint: null })),
      "haiku",
      makeUsage(3_200, 400, 0.003, 2_100, "haiku", 2),
    ),
  );

  // security partitioner crashed before producing output
  const failure: PlanFailure = {
    step: "partitioning",
    review_id: "general/security",
    message:
      'Partitioner failed for criterion "general/security": agent never produced a valid partition. Last validation error: 2 input file(s) missing from partition: src/legacy/PaymentProcessor.php, src/legacy/InvoiceBuilder.php',
  };
  storage.setFailure(planId, failure);
}

// =============================================================================
// Fixture 4 — clean
// =============================================================================

function seedClean(): void {
  const planId = "seed-2026-04-04_clean";
  console.log(`  ${planId}`);

  writeInitialPlan({
    planId,
    name: "diff main",
    scope: { type: "changes", ref: "main" },
    invocation: { command: "deskcheck", args: ["diff", "main"], cwd: "/home/rasmus/prowi-monorepo" },
    createdAt: "2026-04-04T16:22:08Z",
  });

  const matchedFiles = [
    "src/utils/format.ts",
    "src/utils/dates.ts",
    "src/utils/strings.ts",
  ];

  storage.setMatchedFiles(planId, matchedFiles, []);
  storage.setModules(planId, {
    "general/error-handling": makeModuleSummary(
      "general/error-handling",
      "Checks for proper error handling patterns",
      "one task per file",
      "haiku",
      matchedFiles,
    ),
    "general/test-coverage": makeModuleSummary(
      "general/test-coverage",
      "Verifies tests cover the public API of changed services",
      "group test files with their corresponding source files",
      "haiku",
      matchedFiles,
    ),
  });

  storage.setStep(planId, "partitioning");

  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/error-handling",
      matchedFiles,
      "Three small utility files, one task per file.",
      matchedFiles.map((f) => ({ files: [f], focus: null, hint: null })),
      "haiku",
      makeUsage(2_800, 350, 0.003, 1_800, "haiku", 2),
    ),
  );
  storage.setPartitionDecision(
    planId,
    makeDecision(
      "general/test-coverage",
      matchedFiles,
      "No test files in the diff but the source files exist — review each as a single unit to flag missing coverage if any.",
      matchedFiles.map((f) => ({ files: [f], focus: null, hint: null })),
      "haiku",
      makeUsage(2_400, 300, 0.002, 1_600, "haiku", 2),
    ),
  );

  for (const reviewId of ["general/error-handling", "general/test-coverage"]) {
    for (const f of matchedFiles) {
      storage.addTask(planId, {
        review_id: reviewId,
        review_file: `deskcheck/criteria/${reviewId}.md`,
        files: [f],
        focus: null,
        hint: null,
        model: "haiku",
        tools: [],
        prompt: "(snipped)",
      });
    }
  }

  const finalized = storage.finalizePlan(planId);
  finalized.started_at = "2026-04-04T16:22:08Z";
  fs.writeFileSync(
    path.join(storageDir, planId, "plan.json"),
    JSON.stringify(finalized, null, 2) + "\n",
  );
  storage.setStep(planId, "reviewing");

  for (const taskId of Object.keys(storage.getPlan(planId).tasks)) {
    completeTaskFixture(planId, taskId, [], makeUsage(4_200, 500, 0.005, 6_000, "haiku", 2));
  }
}

// =============================================================================
// Fixture 5 — empty-no-match
// =============================================================================

function seedEmpty(): void {
  const planId = "seed-2026-04-05_empty-no-match";
  console.log(`  ${planId}`);

  writeInitialPlan({
    planId,
    name: "diff main",
    scope: { type: "changes", ref: "main" },
    invocation: { command: "deskcheck", args: ["diff", "main"], cwd: "/home/rasmus/prowi-monorepo" },
    createdAt: "2026-04-05T10:01:33Z",
  });

  storage.setMatchedFiles(planId, [], ["docs/RELEASE_NOTES.md", "CHANGELOG.md"]);
  storage.setModules(planId, {});
  storage.setStep(planId, "complete");
}

// =============================================================================
// Issue construction helpers
// =============================================================================

function issue(
  severity: "critical" | "warning" | "info",
  description: string,
  suggestion: string | null,
  references: ReturnType<typeof ref>[],
): Issue {
  return { severity, description, suggestion, references };
}

function ref(
  file: string,
  line: number | null,
  code: string | null,
  suggestedCode: string | null,
  note: string | null,
): { file: string; symbol: null; startLine: number; endLine: number; contextLines: number; code: string | null; suggestedCode: string | null; note: string | null } {
  const startLine = line ?? 0;
  return { file, symbol: null, startLine, endLine: startLine, contextLines: 3, code, suggestedCode, note };
}

function completeTaskFixture(
  planId: string,
  taskId: string,
  issues: Issue[],
  usage: TaskUsage,
): void {
  // Need to claim before completing (storage requires status transition)
  const plan = storage.getPlan(planId);
  if (plan.tasks[taskId]?.status === "pending") {
    storage.claimTask(planId, taskId);
  }
  storage.completeTask(planId, taskId, issues, usage);
}

// =============================================================================
// Run
// =============================================================================

console.log(`Seeding fixtures into ${storageDir}${clean ? " (cleaned)" : ""}:`);
seedCompleteWithIssues();
seedInProgress();
seedFailedPartitioner();
seedClean();
seedEmpty();
console.log(`\nDone. Run \`deskcheck serve\` and visit http://localhost:3000`);
