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
    line: typeof raw.line === "number" ? raw.line : null,
    code: typeof raw.code === "string" ? raw.code : null,
    suggestedCode: typeof raw.suggestedCode === "string" ? raw.suggestedCode : null,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

function legacyFindingToIssue(record: Record<string, unknown>): Issue {
  return {
    severity: String(record.severity ?? "info") as Issue["severity"],
    description: String(record.description ?? ""),
    suggestion: typeof record.suggestion === "string" ? record.suggestion : null,
    references: [{
      file: String(record.file ?? ""),
      symbol: null,
      line: typeof record.line === "number" ? record.line : null,
      code: null,
      suggestedCode: null,
      note: null,
    }],
  };
}

/**
 * Parse executor output into a validated array of issues.
 *
 * Supports both the new Issue format (with `references` array) and the
 * legacy Finding format (with `file` at top level). Legacy findings are
 * automatically converted to Issues with a single Reference.
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

    // New Issue format: has `references` array
    if (Array.isArray(record.references)) {
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
    } else {
      // Legacy Finding format: has `file` at top level
      issues.push(legacyFindingToIssue(record));
    }
  }

  return issues;
}

/**
 * Parse executor output into validated findings (legacy format).
 *
 * @deprecated Use parseIssues instead. This is kept for backwards compatibility
 * with the testing system which still uses the Finding type.
 */
export function parseFindings(output: string): Finding[] {
  const issues = parseIssues(output);
  return issues.map((issue) => ({
    severity: issue.severity,
    file: issue.references[0]?.file ?? "",
    line: issue.references[0]?.line ?? null,
    description: issue.description,
    suggestion: issue.suggestion,
  }));
}
