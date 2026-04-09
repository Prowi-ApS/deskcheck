/**
 * Tests for the partitioner's validation rules. The partitioner agent's
 * output is run through validatePartition before being accepted; these
 * tests pin down the contract.
 */
import { describe, it, expect } from "vitest";
import { validatePartition } from "../src/services/review/ReviewPartitionerService.js";
import type { PartitionedSubtask } from "../src/types/review.js";

describe("validatePartition", () => {
  const inputs = (...files: string[]): Set<string> => new Set(files);

  it("accepts a one-task-per-file partition that covers every input", () => {
    const subtasks: PartitionedSubtask[] = [
      { files: ["a.ts"], focus: null, hint: null },
      { files: ["b.ts"], focus: null, hint: null },
    ];
    expect(validatePartition(subtasks, inputs("a.ts", "b.ts"))).toBeNull();
  });

  it("accepts a single grouped subtask covering everything", () => {
    const subtasks: PartitionedSubtask[] = [
      { files: ["a.ts", "b.ts", "c.ts"], focus: null, hint: "all together" },
    ];
    expect(validatePartition(subtasks, inputs("a.ts", "b.ts", "c.ts"))).toBeNull();
  });

  it("allows a file in multiple subtasks when focus differs (sub-file partitioning)", () => {
    const subtasks: PartitionedSubtask[] = [
      { files: ["a.ts"], focus: "foo", hint: null },
      { files: ["a.ts"], focus: "bar", hint: null },
    ];
    expect(validatePartition(subtasks, inputs("a.ts"))).toBeNull();
  });

  it("rejects an empty subtasks array", () => {
    expect(validatePartition([], inputs("a.ts"))).toMatch(/non-empty/);
  });

  it("rejects a subtask with no files", () => {
    const subtasks: PartitionedSubtask[] = [
      { files: [], focus: null, hint: null },
    ];
    expect(validatePartition(subtasks, inputs("a.ts"))).toMatch(/no files/);
  });

  it("rejects a subtask referencing a file not in the input set", () => {
    const subtasks: PartitionedSubtask[] = [
      { files: ["a.ts", "ghost.ts"], focus: null, hint: null },
    ];
    const err = validatePartition(subtasks, inputs("a.ts"));
    expect(err).toMatch(/ghost\.ts/);
    expect(err).toMatch(/not in the input list/);
  });

  it("rejects a partition that drops an input file", () => {
    const subtasks: PartitionedSubtask[] = [
      { files: ["a.ts"], focus: null, hint: null },
    ];
    const err = validatePartition(subtasks, inputs("a.ts", "b.ts", "c.ts"));
    expect(err).toMatch(/missing from partition/);
    expect(err).toMatch(/b\.ts/);
    expect(err).toMatch(/c\.ts/);
  });

  it("truncates the missing-files list at 5 with an ellipsis", () => {
    const subtasks: PartitionedSubtask[] = [
      { files: ["kept.ts"], focus: null, hint: null },
    ];
    const inputSet = inputs(
      "kept.ts",
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
      "f.ts",
      "g.ts",
    );
    const err = validatePartition(subtasks, inputSet);
    expect(err).toMatch(/7 input file\(s\) missing/);
    expect(err).toMatch(/…$/);
  });
});
