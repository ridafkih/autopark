import { describe, expect, test } from "bun:test";
import { evaluate } from "../../src/core/evaluate.ts";
import type { Evaluation, ReasonCode, Snapshot } from "../../src/core/types.ts";
import { greptile } from "../../src/reviewers/greptile.ts";
import { config, snapshot } from "./build.ts";

export type ReasonRow = [string, Partial<Snapshot>, ReasonCode[], Record<string, unknown>?];

const parsers = new Map([["greptile", greptile]]);

export const evaluateSnapshot = (
  changes: Partial<Snapshot> = {},
  overrides: Record<string, unknown> = {},
  previous: Evaluation | null = null,
) => evaluate(snapshot(changes), config(overrides), parsers, previous);

export const reasonCodes = (changes: Partial<Snapshot>, overrides?: Record<string, unknown>) =>
  evaluateSnapshot(changes, overrides).reasons.map((reason) => reason.code);

export function reasonTable(name: string, rows: ReasonRow[]) {
  describe(name, () => {
    test.each(rows)("%s", (...row: ReasonRow) => {
      const [, changes, expected, overrides] = row;
      expect(reasonCodes(changes, overrides)).toEqual(expected);
    });
  });
}
