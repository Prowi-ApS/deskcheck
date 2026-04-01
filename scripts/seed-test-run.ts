/**
 * Seed a test deskcheck run with realistic Issue data to test the web UI.
 * Run: npx tsx scripts/seed-test-run.ts
 */
import { ReviewStorage } from "../src/core/storage.js";
import type { Issue } from "../src/core/types.js";

const storage = new ReviewStorage(".deskcheck/runs");

// Create plan
const plan = storage.createPlan("UI test run — self-review", {
  type: "file",
  target: "main",
});

// Set modules
storage.setModules(plan.plan_id, {
  "architecture/type-consistency": {
    review_id: "architecture/type-consistency",
    description: "Checks that backend and frontend types stay in sync",
    severity: "high",
    model: "haiku",
    task_count: 0,
    matched_files: ["src/core/types.ts", "ui/src/types.ts"],
  },
  "general/error-handling": {
    review_id: "general/error-handling",
    description: "Checks for proper error handling patterns",
    severity: "medium",
    model: "haiku",
    task_count: 0,
    matched_files: ["src/core/storage.ts", "src/agents/orchestrator.ts", "src/serve.ts"],
  },
});

// Set matched/unmatched files
storage.setMatchedFiles(
  plan.plan_id,
  ["src/core/types.ts", "ui/src/types.ts", "src/core/storage.ts", "src/agents/orchestrator.ts", "src/serve.ts"],
  ["README.md", "package.json", "tsconfig.json"],
);

// Add tasks
storage.addTask(plan.plan_id, {
  review_id: "architecture/type-consistency",
  review_file: "deskcheck/criteria/architecture/type-consistency.md",
  files: ["src/core/types.ts", "ui/src/types.ts"],
  hint: "Check backend vs frontend type sync",
  model: "haiku",
});

storage.addTask(plan.plan_id, {
  review_id: "general/error-handling",
  review_file: "deskcheck/criteria/general/error-handling.md",
  files: ["src/core/storage.ts"],
  hint: null,
  model: "haiku",
});

storage.addTask(plan.plan_id, {
  review_id: "general/error-handling",
  review_file: "deskcheck/criteria/general/error-handling.md",
  files: ["src/agents/orchestrator.ts"],
  hint: null,
  model: "haiku",
});

storage.addTask(plan.plan_id, {
  review_id: "general/error-handling",
  review_file: "deskcheck/criteria/general/error-handling.md",
  files: ["src/serve.ts"],
  hint: null,
  model: "haiku",
});

// Finalize
storage.finalizePlan(plan.plan_id);

// Claim all tasks
const finalPlan = storage.getPlan(plan.plan_id);
for (const task of Object.values(finalPlan.tasks)) {
  storage.claimTask(plan.plan_id, task.task_id, {
    contextType: "file",
    content: "// file content placeholder",
    prompt: "Review this code",
  });
}

// Complete tasks with realistic issues

// Task 1: type-consistency (cross-file issue)
const typeConsistencyIssues: Issue[] = [
  {
    severity: "warning",
    description: "Backend `ModuleIssues` type is not mirrored in frontend types. The frontend still uses the correct name but the `model` field from `ModuleSummary` is typed as `string` in the frontend but `AgentModel` in the backend.",
    suggestion: "Align the `model` field type in the frontend `ModuleSummary` to use the `AgentModel` union type.",
    references: [
      {
        file: "src/core/types.ts",
        symbol: "ModuleSummary::model",
        line: 153,
        code: "model: AgentModel;",
        suggestedCode: null,
        note: "Backend uses AgentModel union type",
      },
      {
        file: "ui/src/types.ts",
        symbol: null,
        line: 46,
        code: "// ModuleSummary does not include model field",
        suggestedCode: "model: 'haiku' | 'sonnet' | 'opus'",
        note: "Frontend is missing the model field entirely",
      },
    ],
  },
  {
    severity: "info",
    description: "The `Finding` type is marked as deprecated in the backend but still exported. Consider removing it once all consumers have migrated to `Issue`.",
    suggestion: null,
    references: [
      {
        file: "src/core/types.ts",
        symbol: "Finding",
        line: 263,
        code: "export interface Finding {\n  severity: FindingSeverity;\n  file: string;\n  line: number | null;\n  description: string;\n  suggestion: string | null;\n}",
        suggestedCode: null,
        note: "Deprecated type still exported",
      },
    ],
  },
];

const taskIds = Object.keys(finalPlan.tasks);
storage.completeTask(plan.plan_id, taskIds[0]!, typeConsistencyIssues, {
  input_tokens: 12500,
  output_tokens: 850,
  cache_read_tokens: 8000,
  cache_creation_tokens: 0,
  cost_usd: 0.0042,
  duration_ms: 3200,
  duration_api_ms: 2800,
  num_turns: 1,
  model: "haiku",
});

// Task 2: error-handling for storage.ts
const storageIssues: Issue[] = [
  {
    severity: "critical",
    description: "The `withLock` method uses `Atomics.wait` on a `SharedArrayBuffer` for spin-waiting, which blocks the event loop. In a Node.js HTTP server context (serve.ts), this could freeze all request handling.",
    suggestion: "Replace `Atomics.wait` with an async retry mechanism using `setTimeout` or `setImmediate` to avoid blocking the event loop.",
    references: [
      {
        file: "src/core/storage.ts",
        symbol: "ReviewStorage::withLock",
        line: 126,
        code: "const wait = new Int32Array(new SharedArrayBuffer(4));\nAtomics.wait(wait, 0, 0, LOCK_SPIN_MS);",
        suggestedCode: "await new Promise(resolve => setTimeout(resolve, LOCK_SPIN_MS));",
        note: "Blocks the event loop during lock contention",
      },
    ],
  },
  {
    severity: "warning",
    description: "Empty catch blocks in lock cleanup suppress potential errors that could indicate filesystem corruption.",
    suggestion: "Log a warning when lock cleanup fails instead of silently swallowing the error.",
    references: [
      {
        file: "src/core/storage.ts",
        symbol: "ReviewStorage::withLock",
        line: 112,
        code: "try { fs.unlinkSync(lockPath); } catch { /* ignore */ }",
        suggestedCode: "try { fs.unlinkSync(lockPath); } catch (err) {\n  console.warn(`[deskcheck] Failed to clean stale lock: ${err}`);\n}",
        note: null,
      },
    ],
  },
];

storage.completeTask(plan.plan_id, taskIds[1]!, storageIssues, {
  input_tokens: 18000,
  output_tokens: 1200,
  cache_read_tokens: 12000,
  cache_creation_tokens: 0,
  cost_usd: 0.0065,
  duration_ms: 4100,
  duration_api_ms: 3500,
  num_turns: 1,
  model: "haiku",
});

// Task 3: error-handling for orchestrator.ts (clean)
storage.completeTask(plan.plan_id, taskIds[2]!, [], {
  input_tokens: 15000,
  output_tokens: 200,
  cache_read_tokens: 10000,
  cache_creation_tokens: 0,
  cost_usd: 0.0038,
  duration_ms: 2800,
  duration_api_ms: 2200,
  num_turns: 1,
  model: "haiku",
});

// Task 4: error-handling for serve.ts
const serveIssues: Issue[] = [
  {
    severity: "warning",
    description: "The HTTP request handler catches errors but returns a generic 500 response without logging. In production this makes debugging server errors very difficult.",
    suggestion: "Add structured error logging with request context before sending the 500 response.",
    references: [
      {
        file: "src/serve.ts",
        symbol: null,
        line: null,
        code: null,
        suggestedCode: null,
        note: "Multiple request handlers lack error logging",
      },
    ],
  },
];

storage.completeTask(plan.plan_id, taskIds[3]!, serveIssues, {
  input_tokens: 14000,
  output_tokens: 600,
  cache_read_tokens: 9000,
  cache_creation_tokens: 0,
  cost_usd: 0.0041,
  duration_ms: 3000,
  duration_api_ms: 2600,
  num_turns: 1,
  model: "haiku",
});

console.log(`\nSeeded test run: ${plan.plan_id}`);
console.log(`\nStarting server on http://localhost:3456 ...\n`);
