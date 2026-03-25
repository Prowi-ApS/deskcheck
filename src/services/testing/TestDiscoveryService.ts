import fs from "node:fs";
import path from "node:path";
import type { TestCase } from "../../types/testing.js";
import { discoverCriteria, filterCriteria } from "../criteria/CriteriaService.js";

/**
 * Discover test cases by scanning the tests directory.
 *
 * Test cases mirror the criteria directory structure:
 *   tests/{criterionId}/{testName}/
 *     - One fixture file (any extension except .md)
 *     - One expected.md describing expected findings
 *
 * @param testsDir - Path to the tests directory.
 * @param criteriaDir - Path to the criteria directory.
 * @param criterionFilter - Optional list of criterion name patterns to include.
 * @returns Sorted array of discovered test cases.
 */
export function discoverTests(
  testsDir: string,
  criteriaDir: string,
  criterionFilter?: string[],
): TestCase[] {
  const absoluteTestsDir = path.resolve(testsDir);
  const absoluteCriteriaDir = path.resolve(criteriaDir);

  // Discover all criteria, optionally filtered
  let criteria = discoverCriteria(absoluteCriteriaDir);
  if (criterionFilter && criterionFilter.length > 0) {
    criteria = filterCriteria(criteria, criterionFilter);
  }

  const testCases: TestCase[] = [];

  for (const criterion of criteria) {
    // Look for matching test directory: testsDir/{criterion.id}/
    const criterionTestDir = path.join(absoluteTestsDir, criterion.id);

    if (!fs.existsSync(criterionTestDir) || !fs.statSync(criterionTestDir).isDirectory()) {
      continue;
    }

    // Each subdirectory is a test case
    const entries = fs.readdirSync(criterionTestDir, { withFileTypes: true });
    const testDirs = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

    for (const testDir of testDirs) {
      const testPath = path.join(criterionTestDir, testDir.name);
      const testFiles = fs.readdirSync(testPath);

      // Find the fixture file (first non-.md file)
      const fixtureFileName = testFiles
        .filter((f) => !f.endsWith(".md"))
        .sort()[0];

      // Check for expected.md
      const hasExpectedMd = testFiles.includes("expected.md");

      if (!fixtureFileName || !hasExpectedMd) {
        console.error(
          `[deskcheck] Warning: skipping test "${testDir.name}" for criterion "${criterion.id}": ` +
          `missing ${!fixtureFileName ? "fixture file" : "expected.md"}`,
        );
        continue;
      }

      testCases.push({
        criterionId: criterion.id,
        name: testDir.name,
        criterionFile: criterion.file,
        fixtureFile: path.join(testPath, fixtureFileName),
        expectedFile: path.join(testPath, "expected.md"),
      });
    }
  }

  // Sort by criterionId, then by name for deterministic ordering
  return testCases.sort((a, b) => {
    const idCompare = a.criterionId.localeCompare(b.criterionId);
    if (idCompare !== 0) return idCompare;
    return a.name.localeCompare(b.name);
  });
}
