import type { ReviewTask } from "../types/review.js";

/**
 * Build the system prompt for an executor agent.
 *
 * The executor receives a single deskcheck task containing the detective prompt
 * (from the criterion), the files to check, and the extracted context
 * (diff, file content, or symbol). It outputs a JSON array of findings to stdout.
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

  // Scope hint
  if (task.hint) {
    sections.push(`## Scope Hint\n${task.hint}`);
  }

  // Review context
  const contextHeader = `## Review Context\n**Context Type:** ${task.context_type}`;
  const symbolLine = task.symbol ? `\n**Symbol:** ${task.symbol}` : "";
  const contextBody = task.context ?? "No context provided.";
  sections.push(`${contextHeader}${symbolLine}\n\n${contextBody}`);

  // Instructions based on context type
  sections.push(buildContextTypeGuidance(task.context_type));

  // Output format instructions
  sections.push(buildOutputInstructions());

  return sections.join("\n\n");
}

/** Guidance on how to review based on the context type. */
function buildContextTypeGuidance(contextType: string): string {
  const header = "## Context Type";

  switch (contextType) {
    case "diff":
      return `${header}\nYou are reviewing a **diff**. The context shows what changed. Apply the criterion's checks to the changed code.`;
    case "file":
      return `${header}\nYou are reviewing **full file contents**. Apply the criterion's checks to the entire file.`;
    case "symbol":
      return `${header}\nYou are reviewing a **specific symbol** (function, class, or method). Apply the criterion's checks to the named symbol.`;
    default:
      return `${header}\nApply the criterion's checks to the provided context.`;
  }
}

/** Instructions for the executor's output format. */
function buildOutputInstructions(): string {
  return `## Your Task
1. Read the review instructions carefully
2. Analyze the code provided in the context
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
      "line": 42,
      "code": "the current code snippet, or null",
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
  - \`line\`: line number for navigation, or null
  - \`code\`: include the relevant code snippet so the reviewer can understand the issue without opening the file. Keep it focused (the relevant function/block, not the entire file).
  - \`suggestedCode\`: when suggesting a fix, show what the code should look like. Use null when the fix is better described in the top-level \`suggestion\`.
  - \`note\`: brief context for why this reference matters (e.g. "First occurrence", "Duplicated", "Missing return type"). Use null when obvious.

### When to use multiple references

- **Cross-file issues**: duplicated patterns across files, missing consistency between related files
- **Single-file issues**: just use one reference

### Code snippets

Include relevant code snippets in \`code\` so the reviewer can understand the issue without opening their editor. When suggesting a fix, include \`suggestedCode\` to show the before/after clearly.

If no issues found, output an empty array: []

Do NOT output any text outside the JSON array. No explanations, no markdown, no commentary — just the JSON array.`;
}
