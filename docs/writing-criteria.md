# Writing Effective Criteria

Lessons learned from real-world testing of deskcheck criteria. This is a living document — update it as we learn more.

---

## The Core Principle

**A criterion is a complete specification.** The executor should check for exactly what the criterion says — nothing more, nothing less. If a criterion produces findings that aren't in its "What to Check" section, the criterion or the model choice is wrong.

An empty findings array is a valid outcome. Deskcheck should not always find something. If it does, people stop reading its output.

---

## Model Selection

The `model` field in criterion frontmatter is the single most important decision. Wrong model choice produces either false positives (freelancing) or false negatives (overcorrection).

### What We Tested

We ran the same criterion (`controller-conventions`) against the same file (`TriggerController.php`) with different models:

| Model | Findings | Legitimate | Freelanced | Cost |
|-------|----------|-----------|------------|------|
| Haiku (loose prompt) | 9 | 1 | 8 | $0.045 |
| Haiku (strict prompt) | 0 | 0 | 0 | $0.039 |
| Sonnet (strict prompt) | 15 | 15 | 0 | $0.32 |

**Haiku cannot hold complex instructions.** With a loose prompt it freelances (invents rules about try-catch, parameter ordering, code duplication). With a strict prompt it overcorrects and finds nothing. It can't balance "check these 4 things but NOT these 5 things" while also analyzing real code.

### Model Guidelines

| Model | Use When | Examples |
|-------|----------|---------|
| **Haiku** | Purely mechanical pattern matching. "Does X exist?" "Is Y imported?" No judgment required. | Check that all files have a license header. Check that no `console.log` exists in production code. |
| **Sonnet** | Judgment-required checks. The criterion references rule files, has a "What NOT to Check" section, or requires understanding code intent. | Controller conventions, DTO enforcement, separation of concerns, naming conventions. |
| **Opus** | Complex multi-step reasoning, cross-file analysis, architectural assessment. | "Does this service maintain a single responsibility across all its methods?" |

**Rule of thumb:** If your criterion has a "What NOT to Check" section, it's not haiku-appropriate. Haiku struggles with exclusion rules.

**Cost consideration:** Sonnet costs ~7x more than haiku per review. But a haiku review that produces 8 false positives and 1 real finding is worse than no review at all. Accuracy matters more than cost.

---

## Criterion Structure

### What Makes a Good Criterion

1. **Specific checklist.** "What to Check" should list concrete, enumerable things. Not "check for best practices" — that's an invitation to freelance.

2. **Explicit exclusions.** "What NOT to Check" is as important as what to check. Without it, the executor will flag adjacent issues it notices.

3. **Severity table.** Define exactly when something is critical vs warning vs info. Don't leave this to the executor's judgment — it will over-escalate.

4. **Reference rule files.** Point the executor to the actual rule files in `.claude/rules/` so it reviews against the documented standard, not its own interpretation.

5. **Output format section.** Tell the executor what to include in each finding: method name, line number, which check it violates, and a concrete fix suggestion.

### Criterion Template

```markdown
---
description: "One-line description of what this criterion checks"
severity: high
globs:
  - "app/path/**/*.php"
mode: "Create one review per changed file"
model: sonnet
---

# [Name] Review

You are reviewing [file type] to check for [specific thing].

## Background

Read these rule files before starting your review:
- `.claude/rules/path/to/rule.md` — What it covers

## What to Check

[Numbered list of specific, concrete things to look for]

## What NOT to Check

[Explicit list of things that might look related but should be ignored]

## Severity Guidance

| Severity | Condition |
|----------|-----------|
| **critical** | [Specific condition] |
| **warning** | [Specific condition] |
| **info** | [Specific condition] |

## Output Format

For each finding, report:
- The method name and line number
- Which check it violates (reference the number from "What to Check")
- The severity level
- A concrete suggestion for how to fix it
```

---

## Common Mistakes

### 1. Using haiku for judgment-required criteria

**Symptom:** Either too many false positives or zero findings depending on prompt strictness.
**Fix:** Use sonnet. The cost difference is worth it.

### 2. Missing "What NOT to Check" section

**Symptom:** Executor flags adjacent issues that look related but aren't in scope.
**Fix:** Explicitly list what's out of scope. Be generous with exclusions.

### 3. Vague severity definitions

**Symptom:** Executor marks everything as critical, or uses inconsistent severity across runs.
**Fix:** Provide a severity table with specific conditions, not vibes.

### 4. Criterion too broad

**Symptom:** A single criterion tries to check 10+ different things across different concerns.
**Fix:** Split into focused criteria. One criterion = one concern. "Controller conventions" and "separation of concerns" are separate criteria even though both apply to controllers.

### 5. No reference to source rules

**Symptom:** Executor reviews against its own understanding of "best practices" rather than the project's documented standards.
**Fix:** Always point to the specific rule files in `.claude/rules/`. The executor has Read/Glob/Grep tools — it can and should read them.

---

## Testing Criteria

### The Problem

Criteria are prompts. Prompts are non-deterministic. You can't assert `expect(findings).toEqual(exact_list)`. But you CAN verify:

1. **Recall** — Known violations are found
2. **Precision** — Clean code produces no findings
3. **Scope** — Findings only reference checks from the criterion (no freelancing)

### Approach: Synthetic Test Fixtures

Each criterion gets a `tests/` directory with small, purpose-built files that contain known violations and known clean code.

```
deskcheck/
├── criteria/
│   └── backend/
│       └── controller-conventions.md
└── tests/
    └── backend/
        └── controller-conventions/
            ├── violations.php          # Has specific, known violations
            ├── clean.php               # Passes all checks — should produce 0 findings
            └── expected.md             # Documents what SHOULD be found in violations.php
```

### The `expected.md` File

Human-written document that describes what the criterion should find. Not an exact match — a checklist for evaluating the run.

```markdown
# Expected Results: controller-conventions

## violations.php

Should find:
- [ ] Line 12: missing return type on `store()` → warning
- [ ] Line 18: `request()` helper instead of injected Request → info
- [ ] Line 25: raw array in Inertia::render instead of Props Data class → warning

Should NOT find:
- [ ] Anything about the try-catch pattern (not in criterion scope)
- [ ] Anything about parameter ordering (not in criterion scope)
- [ ] Anything about code duplication (not in criterion scope)

## clean.php

Should produce: 0 findings
```

### The Test Workflow

```bash
# 1. Run criterion against its violation fixture
deskcheck "review deskcheck/tests/backend/controller-conventions/violations.php" \
  --criteria=controller-conventions

# 2. Run criterion against its clean fixture
deskcheck "review deskcheck/tests/backend/controller-conventions/clean.php" \
  --criteria=controller-conventions

# 3. Compare output against expected.md manually (or with an LLM judge)
```

### Why Synthetic Files?

- **Stable** — test fixtures don't change when the real codebase changes
- **Isolated** — each criterion is tested independently
- **Portable** — ship with the criterion, work in any project
- **Documented** — the fixture IS the specification of what the criterion catches
- **Fast** — small files = small context = fast executor runs

### Writing Good Test Fixtures

**violations.php should:**
- Be minimal — only enough code to trigger the violations
- Have ONE clear violation per check in the criterion
- Include comments marking each intentional violation: `// VIOLATION: missing return type`
- Be a realistic-looking file, not contrived gibberish

**clean.php should:**
- Follow all conventions the criterion checks for
- Be roughly the same structure as violations.php (same class, similar methods)
- Prove the criterion doesn't over-fire on compliant code

### Future: Automated Evaluation

Once we have enough data, we could build a `deskcheck test` command that:
1. Runs each criterion against its fixtures
2. Uses an LLM judge to compare findings against `expected.md`
3. Reports pass/fail per criterion

But start manual. Get the fixtures right first, automate later.
