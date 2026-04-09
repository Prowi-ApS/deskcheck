import type { ReviewTask, Scope } from "../types/review.js";

/**
 * Build the system prompt for an executor agent.
 *
 * The executor receives a single deskcheck task containing the detective prompt
 * (from the criterion), the files to check, and the resolved scope. It uses its
 * built-in tools (Read, Grep, Glob, Bash) to fetch the actual code itself —
 * either by running `git diff` for changes-mode scope or by reading full file
 * contents for all-mode scope. It outputs a JSON array of findings to stdout.
 *
 * CRITICAL DESIGN PRINCIPLE: The executor ONLY reports findings that the criterion
 * explicitly asks it to check. It does NOT do a general code review. The criterion
 * is the complete specification — nothing more, nothing less.
 */
export function buildExecutorPrompt(task: ReviewTask): string {
  const sections: string[] = [];

  sections.push(`You are a criteria-bound code review executor. You check code against ONE specific criterion and report ONLY what that criterion asks you to check.

## CRITICAL CONSTRAINT

You MUST only report findings that are explicitly covered by the "What to Check" section of the criterion below. If something looks wrong but the criterion does not ask you to check for it, DO NOT report it. You are not doing a general code review. You are checking for specific, defined violations.

- If the criterion says "check for X and Y", you check for X and Y. Not Z.
- If the criterion has a "What NOT to Check" section, respect it absolutely.
- If the criterion defines severity levels, use those definitions — not your own.
- An empty findings array is a valid and good outcome. It means the code passes this criterion.
- Do NOT invent rules based on "consistency", "best practices", or patterns you see elsewhere in the file.`);

  // Criterion instructions (the detective prompt from the criterion)
  sections.push(`## Criterion Instructions\n\nThe following is the COMPLETE specification of what to check. Do not go beyond it.\n\n${task.prompt ?? "No instructions provided."}`);

  // Files under review
  const fileList = task.files.map((f) => `- ${f}`).join("\n");
  sections.push(`## Files Under Review\n${fileList}`);

  // Focus — sub-file narrowing set by the partitioner.
  if (task.focus) {
    sections.push(`## Focus\nReview only this part of the assigned files: **${task.focus}**. Ignore code outside this focus, even if you would otherwise flag it.`);
  }

  // Partitioner hint — short rationale for why these files are grouped.
  if (task.hint) {
    sections.push(`## Grouping Hint\n${task.hint}`);
  }

  // Scope + how to gather context
  sections.push(buildScopeSection(task.scope));

  // Output format instructions
  sections.push(buildOutputInstructions());

  return sections.join("\n\n");
}

/** Tells the reviewer what scope it's working under and how to fetch its own context. */
function buildScopeSection(scope: Scope): string {
  if (scope.type === "changes") {
    return `## Scope: changes against \`${scope.ref}\`

You are reviewing **only what changed** against \`${scope.ref}\`. For each file in "Files Under Review", run:

\`\`\`
git diff ${scope.ref} -- <file>
\`\`\`

Apply the criterion's checks to the changed lines. Unchanged code is out of scope — do not report issues that exist in the file but were not introduced or modified by the diff.

You may read additional files (with Read/Grep/Glob) to understand context — for example, reading a related interface to validate a change. But only produce issues whose primary location is one of the files listed above.`;
  }

  return `## Scope: full files

You are reviewing the **full contents** of each assigned file. Use the Read tool to load each file in "Files Under Review" and apply the criterion's checks to the entire file.

You may read additional files (with Read/Grep/Glob) for context — for example, reading a related interface or test. But only produce issues whose primary location is one of the files listed above.`;
}

/** Instructions for the executor's output format. */
function buildOutputInstructions(): string {
  return `## Your Task
1. Read the review instructions carefully
2. Use your tools to gather the code you need to inspect (per the Scope section above)
3. Report issues as a JSON array to stdout

Output ONLY a JSON array of issues. Each issue has references pointing to one or more code locations:
\`\`\`json
{
  "severity": "critical|warning|info",
  "description": "What's wrong",
  "suggestion": "How to fix it (high-level), or null",
  "references": [
    {
      "file": "path/to/file",
      "symbol": "ClassName::method or null",
      "startLine": 42,
      "endLine": 55,
      "contextLines": 3,
      "suggestedCode": "what it should look like, or null",
      "note": "why this location is relevant, or null"
    }
  ]
}
\`\`\`

### Field guide

- \`severity\`: Use the severity levels defined in the criterion above. If the criterion defines when something is "critical" vs "warning" vs "info", follow those definitions exactly.
- \`description\`: clear description of the issue — reference the specific check from the criterion
- \`suggestion\`: high-level fix suggestion, or null
- \`references\`: array of code locations where the issue manifests (at least one required)
  - \`file\`: the file path
  - \`symbol\`: semantic anchor like "ClassName::method" or "ClassName::$property" — stable across refactors. Use null if not applicable.
  - \`startLine\`: first line of the flagged code range (inclusive). REQUIRED.
  - \`endLine\`: last line of the flagged code range (inclusive). REQUIRED. Use the same value as \`startLine\` for single-line issues.
  - \`contextLines\`: how many lines of surrounding context to include above and below the flagged range in the code snippet. Defaults to 3. Use more (e.g. 5-10) when the surrounding function/block is needed to understand the issue, less (0-1) when the flagged line is self-explanatory.
  - Do NOT include a \`code\` field — the actual code snippet will be resolved automatically from the line range.
  - \`suggestedCode\`: when suggesting a concrete replacement, show what the code should look like. Use null when the fix is better described in the top-level \`suggestion\`.
  - \`note\`: brief context for why this reference matters (e.g. "First occurrence", "Duplicated", "Missing return type"). Use null when obvious.

### When to use multiple references

- **Cross-file issues**: duplicated patterns across files, missing consistency between related files
- **Single-file issues**: just use one reference

If no issues found, output an empty array: []

Do NOT output any text outside the JSON array. No explanations, no markdown, no commentary — just the JSON array.`;
}
