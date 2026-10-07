import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/core/evaluate.ts";
import { nextNudgeAt, nudgeKindsOf, trackNudge, type NudgeState } from "../src/core/nudge.ts";
import type { Snapshot } from "../src/core/types.ts";
import { greptile } from "../src/reviewers/greptile.ts";
import { config, HEAD2, snapshot } from "./fixtures/build.ts";
import { MINUTE, openThread } from "./fixtures/nudge-harness.ts";

const parsers = new Map([["greptile", greptile]]);
const nudgeConfig = config().nudge;
const evaluated = (changes: Partial<Snapshot>) =>
  evaluate(snapshot(changes), config(), parsers, null);
const blocked = evaluated({ threads: [openThread] });

const fresh = (overrides: Partial<NudgeState> = {}): NudgeState => ({
  signature: "threads_open",
  since: 0,
  headMovedAt: null,
  lastNudgeAt: null,
  count: 0,
  next: null,
  ...overrides,
});

describe("nudge state", () => {
  test("awaiting_human is a kind on top of the reason codes", () => {
    expect(nudgeKindsOf(evaluated({ approvals: [] }))).toEqual([
      "approval_missing",
      "awaiting_human",
    ]);
  });

  test("the first observation starts the clock", () => {
    expect(trackNudge(null, null, blocked, 5)).toEqual(fresh({ since: 5 }));
  });

  test("the same reasons keep the clock and the nudge count", () => {
    const state = fresh({ lastNudgeAt: 10, count: 1 });
    expect(trackNudge(state, blocked, blocked, 20)).toEqual(state);
  });

  test("different reasons restart the clock and the count", () => {
    const failing = evaluated({ threads: [openThread], mergeable: "CONFLICTING" });
    const state = fresh({ lastNudgeAt: 10, count: 1 });
    expect(trackNudge(state, blocked, failing, 20)).toEqual(
      fresh({ signature: "conflict,threads_open", since: 20 }),
    );
  });

  test("a new head is remembered without restarting the clock", () => {
    const moved = evaluated({ threads: [openThread], headSha: HEAD2 });
    expect(trackNudge(fresh(), blocked, moved, 20)).toEqual(fresh({ headMovedAt: 20 }));
  });

  test("a closed PR has no nudge state", () => {
    expect(trackNudge(fresh(), blocked, evaluated({ state: "MERGED" }), 20)).toBeNull();
  });
});

describe("next nudge", () => {
  test.each<[string, NudgeState, number | null, number | null]>([
    ["first nudge after `after`", fresh(), null, 10 * MINUTE],
    ["repeat after `every`", fresh({ lastNudgeAt: 30 * MINUTE }), null, 40 * MINUTE],
    ["a recent head pushes it out", fresh({ headMovedAt: 7 * MINUTE }), null, 17 * MINUTE],
    ["a hold pushes it to the hold's end", fresh(), 45 * MINUTE, 45 * MINUTE],
  ])("%s", (label, state, heldUntil, expected) => {
    expect(nextNudgeAt(state, blocked, nudgeConfig, heldUntil)).toBe(expected);
  });

  test.each<[string, Partial<Snapshot>]>([
    ["ready", {}],
    ["draft", { isDraft: true, threads: [openThread] }],
    ["closed", { state: "CLOSED", threads: [openThread] }],
  ])("%s never nudges", (label, changes) => {
    expect(nextNudgeAt(fresh(), evaluated(changes), nudgeConfig, null)).toBeNull();
  });
});
