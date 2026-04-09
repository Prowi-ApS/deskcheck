import fs from "node:fs";
import path from "node:path";
import type { Issue } from "../../types/review.js";

/**
 * Resolves code snippets for issue references by reading the actual files
 * from disk. Populates the `reference.code` field with the lines indicated
 * by `startLine`/`endLine`, padded by `contextLines` on each side.
 *
 * This is a pure post-processing step — no LLM involved.
 */
export function resolveCodeSnippets(issues: Issue[], projectRoot: string): Issue[] {
  // Cache file contents to avoid re-reading the same file for multiple references
  const fileCache = new Map<string, string[] | null>();

  function getLines(filePath: string): string[] | null {
    if (fileCache.has(filePath)) return fileCache.get(filePath)!;

    const absPath = path.resolve(projectRoot, filePath);
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      const lines = content.split("\n");
      fileCache.set(filePath, lines);
      return lines;
    } catch {
      console.error(`[deskcheck] Warning: could not read file for snippet resolution: ${filePath}`);
      fileCache.set(filePath, null);
      return null;
    }
  }

  for (const issue of issues) {
    for (const ref of issue.references) {
      if (ref.startLine <= 0 || ref.endLine <= 0) {
        ref.code = null;
        continue;
      }

      const lines = getLines(ref.file);
      if (!lines) {
        ref.code = null;
        continue;
      }

      // Lines are 1-indexed, array is 0-indexed. Pad with contextLines.
      const ctx = ref.contextLines;
      const start = Math.max(ref.startLine - 1 - ctx, 0);
      const end = Math.min(ref.endLine + ctx, lines.length); // slice end is exclusive

      if (ref.startLine - 1 >= lines.length || ref.startLine - 1 < 0) {
        console.error(`[deskcheck] Warning: line range ${ref.startLine}-${ref.endLine} out of bounds for ${ref.file} (${lines.length} lines)`);
        ref.code = null;
        continue;
      }

      ref.code = lines.slice(start, end).join("\n");
    }
  }

  return issues;
}
