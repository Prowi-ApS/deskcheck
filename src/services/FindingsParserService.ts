import type { Issue, Reference, Finding, FindingSeverity } from "../types/review.js";

export type { Issue, Reference };

const VALID_SEVERITIES: ReadonlySet<string> = new Set<FindingSeverity>([
  "critical",
  "warning",
  "info",
]);

function parseReference(raw: Record<string, unknown>): Reference {
  return {
    file: String(raw.file ?? ""),
    symbol: typeof raw.symbol === "string" ? raw.symbol : null,
    startLine: typeof raw.startLine === "number" ? raw.startLine : 0,
    endLine: typeof raw.endLine === "number" ? raw.endLine : (typeof raw.startLine === "number" ? raw.startLine : 0),
    contextLines: typeof raw.contextLines === "number" ? raw.contextLines : 3,
    code: null, // Always null at parse time — populated by CodeSnippetService
    suggestedCode: typeof raw.suggestedCode === "string" ? raw.suggestedCode : null,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

/**
 * Parse executor output into a validated array of issues.
 */
export function parseIssues(output: string): Issue[] {
  // Try to extract JSON array from the output
  let jsonText = output.trim();

  // Strip markdown code fences if present
  const fencedMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fencedMatch) {
    jsonText = fencedMatch[1]!.trim();
  }

  // Find the JSON array boundaries
  const startIdx = jsonText.indexOf("[");
  const endIdx = jsonText.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    console.error(`[deskcheck] Warning: executor output did not contain a JSON array. Output: ${output.slice(0, 200)}`);
    return [];
  }

  jsonText = jsonText.slice(startIdx, endIdx + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error(`[deskcheck] Warning: failed to parse executor JSON output: ${error instanceof Error ? error.message : String(error)}. Output: ${jsonText.slice(0, 200)}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error(`[deskcheck] Warning: executor output parsed but was not an array. Type: ${typeof parsed}`);
    return [];
  }

  // Validate and normalize each item
  const issues: Issue[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      console.error(`[deskcheck] Warning: skipping invalid item (not an object): ${JSON.stringify(item).slice(0, 100)}`);
      continue;
    }

    const record = item as Record<string, unknown>;
    const severity = String(record.severity ?? "info");
    if (!VALID_SEVERITIES.has(severity)) {
      console.error(`[deskcheck] Warning: skipping item with invalid severity "${severity}"`);
      continue;
    }

    if (!Array.isArray(record.references) || record.references.length === 0) continue;

    const references: Reference[] = [];
    for (const ref of record.references) {
      if (typeof ref === "object" && ref !== null) {
        references.push(parseReference(ref as Record<string, unknown>));
      }
    }
    if (references.length === 0) continue;
    issues.push({
      severity: severity as FindingSeverity,
      description: String(record.description ?? ""),
      suggestion: typeof record.suggestion === "string" ? record.suggestion : null,
      references,
    });
  }

  return issues;
}

/**
 * Parse executor output into findings for the testing subsystem.
 */
export function parseFindings(output: string): Finding[] {
  const issues = parseIssues(output);
  return issues.map((issue) => ({
    severity: issue.severity,
    file: issue.references[0]?.file ?? "",
    line: issue.references[0]?.startLine ?? null,
    description: issue.description,
    suggestion: issue.suggestion,
  }));
}
