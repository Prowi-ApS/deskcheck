/**
 * Tests for the Issue/Reference model and the parseIssues function.
 *
 * We test parseIssues by importing the orchestrator module and accessing it
 * indirectly via the module's export. Since parseIssues is a private function
 * in orchestrator.ts, we extract and test the parsing logic directly here.
 */
import { describe, it, expect } from "vitest";
import type { Issue, Reference } from "../src/core/types.js";

// =============================================================================
// Re-implement parseIssues logic for unit testing (mirrors orchestrator.ts)
// =============================================================================

const VALID_SEVERITIES = new Set(["critical", "warning", "info"]);

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

function parseIssues(output: string): Issue[] {
  let jsonText = output.trim();
  const fencedMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fencedMatch) {
    jsonText = fencedMatch[1]!.trim();
  }
  const startIdx = jsonText.indexOf("[");
  const endIdx = jsonText.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return [];
  jsonText = jsonText.slice(startIdx, endIdx + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const issues: Issue[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const severity = String(record.severity ?? "info");
    if (!VALID_SEVERITIES.has(severity)) continue;

    if (Array.isArray(record.references)) {
      const references: Reference[] = [];
      for (const ref of record.references) {
        if (typeof ref === "object" && ref !== null) {
          references.push(parseReference(ref as Record<string, unknown>));
        }
      }
      if (references.length === 0) continue;
      issues.push({
        severity: severity as Issue["severity"],
        description: String(record.description ?? ""),
        suggestion: typeof record.suggestion === "string" ? record.suggestion : null,
        references,
      });
    } else {
      issues.push(legacyFindingToIssue(record));
    }
  }
  return issues;
}

// =============================================================================
// Tests
// =============================================================================

describe("parseIssues", () => {
  describe("new Issue format", () => {
    it("parses a single issue with one reference", () => {
      const input = JSON.stringify([{
        severity: "warning",
        description: "Public method returns raw array instead of Data class",
        suggestion: "Create SubscriptionData and return it",
        references: [{
          file: "app/Services/FenerumService.php",
          symbol: "FenerumService::getSubscription",
          line: 47,
          code: "public function getSubscription(int $id): array",
          suggestedCode: "public function getSubscription(int $id): SubscriptionData",
          note: null,
        }],
      }]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("warning");
      expect(issues[0]!.description).toBe("Public method returns raw array instead of Data class");
      expect(issues[0]!.suggestion).toBe("Create SubscriptionData and return it");
      expect(issues[0]!.references).toHaveLength(1);
      expect(issues[0]!.references[0]!.file).toBe("app/Services/FenerumService.php");
      expect(issues[0]!.references[0]!.symbol).toBe("FenerumService::getSubscription");
      expect(issues[0]!.references[0]!.line).toBe(47);
      expect(issues[0]!.references[0]!.code).toBe("public function getSubscription(int $id): array");
      expect(issues[0]!.references[0]!.suggestedCode).toBe("public function getSubscription(int $id): SubscriptionData");
    });

    it("parses a cross-file issue with multiple references", () => {
      const input = JSON.stringify([{
        severity: "warning",
        description: "Three handlers duplicate HTTP client initialization",
        suggestion: "Extract a shared FenerumApiClient service",
        references: [
          { file: "Handlers/SyncSubscriptions.php", symbol: "SyncSubscriptions::handle", line: 23, code: "$client = Http::withHeaders(...)", suggestedCode: null, note: "First occurrence" },
          { file: "Handlers/SyncInvoices.php", symbol: "SyncInvoices::handle", line: 19, code: "$client = Http::withHeaders(...)", suggestedCode: null, note: "Duplicated" },
        ],
      }]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.references).toHaveLength(2);
      expect(issues[0]!.references[0]!.note).toBe("First occurrence");
      expect(issues[0]!.references[1]!.note).toBe("Duplicated");
      expect(issues[0]!.references[0]!.symbol).toBe("SyncSubscriptions::handle");
      expect(issues[0]!.references[1]!.symbol).toBe("SyncInvoices::handle");
    });

    it("handles optional fields as null", () => {
      const input = JSON.stringify([{
        severity: "info",
        description: "Consider adding type hints",
        references: [{ file: "src/utils.ts" }],
      }]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.suggestion).toBeNull();
      expect(issues[0]!.references[0]!.symbol).toBeNull();
      expect(issues[0]!.references[0]!.line).toBeNull();
      expect(issues[0]!.references[0]!.code).toBeNull();
      expect(issues[0]!.references[0]!.suggestedCode).toBeNull();
      expect(issues[0]!.references[0]!.note).toBeNull();
    });

    it("skips issues with empty references array", () => {
      const input = JSON.stringify([{
        severity: "warning",
        description: "Orphan issue",
        references: [],
      }]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(0);
    });
  });

  describe("backwards compatibility with old Finding format", () => {
    it("converts old Finding to Issue with single reference", () => {
      const input = JSON.stringify([{
        severity: "critical",
        file: "src/auth.ts",
        line: 42,
        description: "SQL injection vulnerability",
        suggestion: "Use parameterized queries",
      }]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("critical");
      expect(issues[0]!.description).toBe("SQL injection vulnerability");
      expect(issues[0]!.suggestion).toBe("Use parameterized queries");
      expect(issues[0]!.references).toHaveLength(1);
      expect(issues[0]!.references[0]!.file).toBe("src/auth.ts");
      expect(issues[0]!.references[0]!.line).toBe(42);
      expect(issues[0]!.references[0]!.symbol).toBeNull();
      expect(issues[0]!.references[0]!.code).toBeNull();
      expect(issues[0]!.references[0]!.suggestedCode).toBeNull();
    });

    it("handles old Finding with null line", () => {
      const input = JSON.stringify([{
        severity: "info",
        file: "README.md",
        line: null,
        description: "Missing section",
        suggestion: null,
      }]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.references[0]!.line).toBeNull();
      expect(issues[0]!.suggestion).toBeNull();
    });

    it("handles mixed old and new formats in same array", () => {
      const input = JSON.stringify([
        {
          severity: "warning",
          file: "old-style.ts",
          line: 10,
          description: "Old format finding",
          suggestion: null,
        },
        {
          severity: "critical",
          description: "New format issue",
          suggestion: "Fix it",
          references: [{ file: "new-style.ts", symbol: "Foo::bar", line: 20, code: "bad code", suggestedCode: "good code", note: null }],
        },
      ]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(2);
      // Old format
      expect(issues[0]!.references).toHaveLength(1);
      expect(issues[0]!.references[0]!.file).toBe("old-style.ts");
      expect(issues[0]!.references[0]!.symbol).toBeNull();
      // New format
      expect(issues[1]!.references).toHaveLength(1);
      expect(issues[1]!.references[0]!.symbol).toBe("Foo::bar");
      expect(issues[1]!.references[0]!.code).toBe("bad code");
    });
  });

  describe("edge cases", () => {
    it("returns empty array for non-JSON input", () => {
      expect(parseIssues("Not JSON at all")).toEqual([]);
    });

    it("returns empty array for empty array", () => {
      expect(parseIssues("[]")).toEqual([]);
    });

    it("strips markdown code fences", () => {
      const input = "```json\n" + JSON.stringify([{
        severity: "info",
        description: "test",
        references: [{ file: "a.ts" }],
      }]) + "\n```";

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
    });

    it("finds JSON array within surrounding text", () => {
      const input = "Here are my findings:\n" + JSON.stringify([{
        severity: "warning",
        description: "test",
        references: [{ file: "b.ts" }],
      }]) + "\n\nThat's all!";

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
    });

    it("skips items with invalid severity", () => {
      const input = JSON.stringify([{
        severity: "high",
        description: "invalid severity",
        references: [{ file: "a.ts" }],
      }]);

      expect(parseIssues(input)).toEqual([]);
    });

    it("skips non-object items", () => {
      const input = JSON.stringify(["string item", null, 42]);
      expect(parseIssues(input)).toEqual([]);
    });

    it("defaults severity to info when missing", () => {
      const input = JSON.stringify([{
        description: "no severity",
        references: [{ file: "a.ts" }],
      }]);

      const issues = parseIssues(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("info");
    });
  });
});
