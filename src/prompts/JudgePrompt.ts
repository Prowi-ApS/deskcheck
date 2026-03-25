import type { Finding } from "../types/review.js";

/**
 * Build the system prompt for a judge agent.
 *
 * The judge evaluates executor findings against expected results from a test
 * case. It determines whether each finding is correct, out of scope, or has
 * wrong severity, and whether each expectation was found or missed.
 *
 * @param criterionBody - The criterion's detective prompt (what was checked).
 * @param expectedContent - Content of expected.md (what should/shouldn't be found).
 * @param findings - Findings produced by the executor agent.
 * @param fixtureContent - Content of the fixture file that was reviewed.
 * @returns The complete judge prompt as a string.
 */
export function buildJudgePrompt(
  criterionBody: string,
  expectedContent: string,
  findings: Finding[],
  fixtureContent: string,
): string {
  const sections: string[] = [];

  sections.push(
    `You are a test judge for a code review criterion. Your job is to evaluate whether the executor's findings match the expectations.`,
  );

  sections.push(
    `## The Criterion Being Tested\n\n${criterionBody}`,
  );

  sections.push(
    `## The Fixture File\n\n\`\`\`\n${fixtureContent}\n\`\`\``,
  );

  sections.push(
    `## Expected Results\n\n${expectedContent}`,
  );

  sections.push(
    `## Actual Findings\n\n\`\`\`json\n${JSON.stringify(findings, null, 2)}\n\`\`\``,
  );

  sections.push(
    `## Your Task

For EACH finding the executor produced, determine:
- Is it "correct" — it matches something the criterion asks to check AND is described in the "Should Find" section of expected results?
- Is it "out_of_scope" — the finding is about something NOT in the criterion's checklist (freelancing)?
- Is it "incorrect_severity" — the finding is in scope but uses the wrong severity level per the criterion's severity table?

For EACH expectation in the "Should Find" section, determine:
- Was it "found" — does at least one finding match this expectation?
- Was it "missed" — no finding corresponds to this expectation?

Also check the "Should Not Find" section — if any finding matches something listed there, mark that finding as "out_of_scope".

Output ONLY a JSON object with this structure:
{
  "findings_review": [
    {
      "finding": "description of the executor's finding",
      "verdict": "correct" | "out_of_scope" | "incorrect_severity",
      "criterion_check": "#N — check name" or null,
      "comment": "brief explanation"
    }
  ],
  "expectations_review": [
    {
      "expectation": "the expected item from expected.md",
      "verdict": "found" | "missed",
      "matched_finding": "description of matching finding" or null,
      "comment": "brief explanation"
    }
  ]
}

Do NOT output any text outside the JSON object. No explanations, no markdown, just the JSON.`,
  );

  return sections.join("\n\n");
}
