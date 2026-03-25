# Writing Effective Criteria

Lessons learned from real-world testing of deskcheck criteria.

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
| **Sonnet** | Judgment-required checks. The criterion references rule files, has a "What NOT to Check" section, or requires understanding code intent. **Default choice.** | Controller conventions, DTO enforcement, separation of concerns, naming conventions. |
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

## Writing Test Fixtures

### Fixture Rules

- **Never hint at violations in fixture code.** No `// VIOLATION:` or `// CLEAN:` comments. The executor must find violations on its own — that's what we're testing.
- Be minimal — only enough code to trigger the target violations.
- Be realistic — the code should look like real code, not contrived gibberish.
- One clear violation per check in the criterion.

### expected.md Rules

- **Keep expectations focused on key violations, not every symptom.** A criterion checking for `$request->validate()` should expect "found raw validate()" — not every individual `$validated['key']` access downstream. Too many granular expectations lead to brittle tests.
- Use the structured sections: `## Should Find`, `## Should Not Find`, `## Notes`.
- "Should Not Find" is as important as "Should Find" — it catches freelancing.

### Always include a clean fixture

A clean file that follows all conventions should produce zero findings. This verifies the criterion doesn't over-fire on compliant code.

---

## Intermittent Issues

### Executor output truncation

When the executor produces many findings with long suggestions, the JSON output can get cut off mid-string, causing parse failures. The judge then reports 0% recall because it received no findings.

**Mitigation:** Keep expectations focused on the key violations. Fewer, more important expectations are more resilient than many granular ones.

### Non-determinism

Criteria are prompts. Results vary between runs. A test might pass 9/10 times. This is expected. The test infrastructure gives you a way to detect and fix common failure modes, not guarantee deterministic output.
