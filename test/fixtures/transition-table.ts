import { describe, expect, test } from "bun:test";
import { evaluate } from "../../src/core/evaluate.ts";
import { diff } from "../../src/core/transitions.ts";
import type { Evaluation, Snapshot, TransitionKind } from "../../src/core/types.ts";
import { greptile } from "../../src/reviewers/greptile.ts";
import { check, config, snapshot } from "./build.ts";

type SnapshotChanges = Partial<Snapshot>;

export type TransitionRow = [
  string,
  SnapshotChanges | null,
  SnapshotChanges,
  TransitionKind[],
  { exhausted?: boolean }?,
];

const parsers = new Map([["greptile", greptile]]);
const freshnessConfig = config({ readiness: { baseFreshness: { policy: "contains-tip" } } });

export const evaluateChanges = (changes: SnapshotChanges, previous: Evaluation | null = null) =>
  evaluate(snapshot(changes), freshnessConfig, parsers, previous);

export const evaluatePrevious = (changes: SnapshotChanges | null) =>
  changes === null ? null : evaluateChanges(changes);

export function transitionTable(name: string, kinds: TransitionKind[], rows: TransitionRow[]) {
  describe(name, () => {
    test.each(rows)("%s", (...row: TransitionRow) => {
      const [, previousChanges, nextChanges, expected, options] = row;
      const previous = evaluatePrevious(previousChanges);
      const next = evaluateChanges(nextChanges, previous);
      const emitted = diff(previous, next, { mergeabilityExhausted: options?.exhausted })
        .map((transition) => transition.kind)
        .filter((kind) => kinds.includes(kind));
      expect(emitted).toEqual(expected);
    });
  });
}

export const unapproved = { approvals: [] };

export const failing = (name = "build") => ({
  checks: [check(name, "fail"), check("gate", "pass")],
});

export const thread = (id: string, isResolved = false) => ({
  id,
  resolved: isResolved,
  outdated: false,
  author: "greptile-apps",
  path: "a.ts",
  url: null,
});
