import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ContextType } from "../../types/review.js";

/** The result of extracting review context for a task. */
export interface ExtractedContext {
  contextType: ContextType;
  content: string;
  symbol: string | null;
}

/**
 * Extract review context based on the source type.
 *
 * - diff: runs `git diff` for the given files against the source target
 * - file: reads each file's content from disk
 * - symbol: reads the file containing the symbol (symbol identification
 *   is left to the executor agent which has Read/Grep tools)
 */
export function extractContext(
  sourceType: ContextType,
  sourceTarget: string,
  files: string[],
  projectRoot: string,
  symbol?: string,
): ExtractedContext {
  let content: string;

  switch (sourceType) {
    case "diff":
      content = extractDiffContext(sourceTarget, files, projectRoot);
      break;
    case "file":
      content = extractFileContext(files, projectRoot);
      break;
    case "symbol":
      content = extractFileContext(files, projectRoot);
      break;
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }

  return {
    contextType: sourceType,
    content,
    symbol: symbol ?? null,
  };
}

/** Run git diff for each file and concatenate results. */
function extractDiffContext(
  target: string,
  files: string[],
  projectRoot: string,
): string {
  const parts: string[] = [];

  for (const file of files) {
    try {
      const diff = execFileSync("git", ["diff", target, "--", file], {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });

      if (diff.trim().length > 0) {
        parts.push(diff);
      }
    } catch (error) {
      console.error(
        `Warning: git diff failed for ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return parts.join("\n");
}

/** Read each file's content and concatenate with file path headers. */
function extractFileContext(
  files: string[],
  projectRoot: string,
): string {
  const parts: string[] = [];

  for (const file of files) {
    try {
      const absolutePath = path.resolve(projectRoot, file);
      const content = fs.readFileSync(absolutePath, "utf-8");
      parts.push(`--- ${file} ---\n${content}`);
    } catch (error) {
      console.error(
        `Warning: could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return parts.join("\n\n");
}
