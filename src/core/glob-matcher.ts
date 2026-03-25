import { minimatch } from "minimatch";
import type { ReviewModule } from "../types/criteria.js";

/** The result of matching changed files against a single criterion. */
export interface MatchResult {
  /** The criterion that matched. */
  module: ReviewModule;
  /** Files from the changed set that matched the criterion's globs. */
  matchedFiles: string[];
}

/**
 * Check whether a single file path matches a set of glob patterns.
 *
 * Globs prefixed with `!` act as exclusion patterns: if a file matches any
 * exclusion glob, it is NOT considered a match even if it matches a positive glob.
 * Positive globs are checked first; then exclusions are applied to remove matches.
 *
 * @param filePath - The file path to test (e.g. "app/Http/Controllers/OrderController.php").
 * @param globs - Array of glob patterns. Prefix with `!` to exclude.
 * @returns True if the file matches at least one positive glob and no exclusion globs.
 */
export function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  const positiveGlobs: string[] = [];
  const exclusionGlobs: string[] = [];

  for (const glob of globs) {
    if (glob.startsWith("!")) {
      exclusionGlobs.push(glob.slice(1));
    } else {
      positiveGlobs.push(glob);
    }
  }

  const matchesPositive = positiveGlobs.some((pattern) =>
    minimatch(filePath, pattern),
  );

  if (!matchesPositive) {
    return false;
  }

  const matchesExclusion = exclusionGlobs.some((pattern) =>
    minimatch(filePath, pattern),
  );

  return !matchesExclusion;
}

/**
 * Find which criteria match a set of changed files.
 *
 * For each criterion, checks every changed file against the criterion's glob patterns.
 * Criteria with at least one matching file are included in the results.
 *
 * @param changedFiles - Array of file paths that were changed.
 * @param modules - Array of criteria to match against.
 * @returns Array of match results, one per criterion that matched at least one file.
 */
export function findMatchingModules(
  changedFiles: string[],
  modules: ReviewModule[],
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const module of modules) {
    const matchedFiles = changedFiles.filter((file) =>
      fileMatchesGlobs(file, module.globs),
    );

    if (matchedFiles.length > 0) {
      results.push({ module, matchedFiles });
    }
  }

  return results;
}
