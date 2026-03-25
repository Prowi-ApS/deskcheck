import type { Finding, FindingSeverity } from "../types/review.js";

const VALID_SEVERITIES: ReadonlySet<string> = new Set<FindingSeverity>([
  "critical",
  "warning",
  "info",
]);

/**
 * Parse executor output into a validated array of findings.
 *
 * The executor is instructed to output only a JSON array. This function
 * extracts the JSON from the response text, handles cases where the agent
 * wraps it in markdown fences, and validates each finding's structure.
 */
export function parseFindings(output: string): Finding[] {
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

  // Validate and normalize each finding
  const findings: Finding[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      console.error(`[deskcheck] Warning: skipping invalid finding (not an object): ${JSON.stringify(item).slice(0, 100)}`);
      continue;
    }

    const record = item as Record<string, unknown>;
    const severity = String(record.severity ?? "info");
    if (!VALID_SEVERITIES.has(severity)) {
      console.error(`[deskcheck] Warning: skipping finding with invalid severity "${severity}"`);
      continue;
    }

    findings.push({
      severity: severity as FindingSeverity,
      file: String(record.file ?? ""),
      line: typeof record.line === "number" ? record.line : null,
      description: String(record.description ?? ""),
      suggestion: typeof record.suggestion === "string" ? record.suggestion : null,
    });
  }

  return findings;
}
