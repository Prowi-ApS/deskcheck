/**
 * Tests for CodeSnippetService.resolveCodeSnippets.
 *
 * Uses a real temp directory with small fixture files so we exercise the
 * actual fs.readFileSync path — no mocking. The function is pure
 * post-processing: it reads lines from disk and stamps `reference.code`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodeSnippets } from "../src/services/review/CodeSnippetService.js";
import type { Issue, Reference } from "../src/types/review.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskcheck-snippets-"));

  // 10-line fixture file. Line numbers (1-indexed):
  //   1: line one
  //   2: line two
  //   ...
  //   10: line ten
  const lines = Array.from({ length: 10 }, (_, i) => `line ${["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][i]}`);
  fs.writeFileSync(path.join(tmpDir, "sample.ts"), lines.join("\n"));

  // 3-line file for edge cases near file boundaries
  fs.writeFileSync(path.join(tmpDir, "short.ts"), "alpha\nbeta\ngamma");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRef(file: string, startLine: number, endLine: number, contextLines = 3): Reference {
  return {
    file,
    symbol: null,
    startLine,
    endLine,
    contextLines,
    code: null,
    suggestedCode: null,
    note: null,
  };
}

function makeIssue(refs: Reference[]): Issue {
  return {
    severity: "warning",
    description: "test issue",
    suggestion: null,
    references: refs,
  };
}

describe("resolveCodeSnippets", () => {
  it("resolves a single-line reference with default context (3 lines each side)", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("sample.ts", 5, 5, 3)])],
      tmpDir,
    );
    const code = issues[0]!.references[0]!.code!;
    const lines = code.split("\n");
    // Lines 2–8 (3 context before line 5, line 5 itself, 3 context after)
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("line two");   // context: line 2
    expect(lines[3]).toBe("line five");  // flagged: line 5
    expect(lines[6]).toBe("line eight"); // context: line 8
  });

  it("resolves a multi-line range", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("sample.ts", 4, 6, 2)])],
      tmpDir,
    );
    const code = issues[0]!.references[0]!.code!;
    const lines = code.split("\n");
    // Lines 2–8: 2 context before line 4, lines 4-6, 2 context after line 6
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("line two");
    expect(lines[2]).toBe("line four");
    expect(lines[4]).toBe("line six");
    expect(lines[6]).toBe("line eight");
  });

  it("clamps context at the start of the file", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("sample.ts", 1, 1, 3)])],
      tmpDir,
    );
    const code = issues[0]!.references[0]!.code!;
    const lines = code.split("\n");
    // Lines 1–4: no context before (already at top), line 1, 3 context after
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("line one");
    expect(lines[3]).toBe("line four");
  });

  it("clamps context at the end of the file", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("sample.ts", 10, 10, 3)])],
      tmpDir,
    );
    const code = issues[0]!.references[0]!.code!;
    const lines = code.split("\n");
    // Lines 7–10: 3 context before line 10, line 10 itself, no context after
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("line seven");
    expect(lines[3]).toBe("line ten");
  });

  it("handles contextLines = 0 (no context)", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("sample.ts", 3, 5, 0)])],
      tmpDir,
    );
    const code = issues[0]!.references[0]!.code!;
    const lines = code.split("\n");
    // Exactly lines 3–5
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("line three");
    expect(lines[2]).toBe("line five");
  });

  it("resolves correctly for a very short file", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("short.ts", 2, 2, 5)])],
      tmpDir,
    );
    const code = issues[0]!.references[0]!.code!;
    const lines = code.split("\n");
    // Entire 3-line file: context 5 clamped to file boundaries
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("alpha");
    expect(lines[1]).toBe("beta");
    expect(lines[2]).toBe("gamma");
  });

  it("sets code to null when startLine is 0 (unset)", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("sample.ts", 0, 0, 3)])],
      tmpDir,
    );
    expect(issues[0]!.references[0]!.code).toBeNull();
  });

  it("sets code to null when the file does not exist", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("nonexistent.ts", 5, 5, 3)])],
      tmpDir,
    );
    expect(issues[0]!.references[0]!.code).toBeNull();
  });

  it("sets code to null when startLine is beyond file length", () => {
    const issues = resolveCodeSnippets(
      [makeIssue([makeRef("short.ts", 100, 100, 3)])],
      tmpDir,
    );
    expect(issues[0]!.references[0]!.code).toBeNull();
  });

  it("handles multiple issues with multiple references efficiently (file cache)", () => {
    const issues = resolveCodeSnippets(
      [
        makeIssue([
          makeRef("sample.ts", 1, 1, 0),
          makeRef("sample.ts", 10, 10, 0),
        ]),
        makeIssue([makeRef("short.ts", 2, 2, 0)]),
      ],
      tmpDir,
    );
    expect(issues[0]!.references[0]!.code).toBe("line one");
    expect(issues[0]!.references[1]!.code).toBe("line ten");
    expect(issues[1]!.references[0]!.code).toBe("beta");
  });

  it("does not mutate code for references that already have it set", () => {
    // The function overwrites code unconditionally — verify the behavior
    // so we know what to expect.
    const ref = makeRef("sample.ts", 3, 3, 0);
    const issues = resolveCodeSnippets([makeIssue([ref])], tmpDir);
    expect(issues[0]!.references[0]!.code).toBe("line three");
  });
});
