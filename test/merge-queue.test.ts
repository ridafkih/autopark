import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/core/evaluate.ts";
import { nudgeKindsOf, shouldNudge } from "../src/core/nudge.ts";
import type { Snapshot } from "../src/core/types.ts";
import { isEvaluation } from "../src/daemon/evaluation-guard.ts";
import { greptile } from "../src/reviewers/greptile.ts";
import { config, snapshot } from "./fixtures/build.ts";
import { kindsFor, view } from "./fixtures/stop-views.ts";

const parsers = new Map([["greptile", greptile]]);
const nudgeConfig = config({ nudge: { nudgeReadyUnmerged: true } }).nudge;
const QUEUED = { state: "AWAITING_CHECKS", position: 6, enqueuedAt: "2026-11-04T21:45:11Z" };

const evaluated = (changes: Partial<Snapshot>) =>
  evaluate(snapshot(changes), config(), parsers, null);

describe("queued evaluation", () => {
  const queued = evaluated({ mergeQueue: QUEUED });

  test("keeps the queue entry", () => {
    expect(queued.mergeQueue).toEqual(QUEUED);
  });

  test("is never mergeable now or awaiting a human", () => {
    expect(queued.mergeableNow).toBe(false);
    expect(evaluated({ mergeQueue: QUEUED, approvals: [] }).awaitingHuman).toBe(false);
  });

  test("is never nudged, even when ready and unmerged nudges are on", () => {
    expect(shouldNudge(queued, nudgeConfig)).toBe(false);
    expect(shouldNudge(evaluated({ mergeQueue: QUEUED, approvals: [] }), nudgeConfig)).toBe(false);
    expect(nudgeKindsOf(evaluated({ mergeQueue: QUEUED, approvals: [] }))).not.toContain(
      "awaiting_human",
    );
  });

  test("a ready PR outside the queue still nudges when configured", () => {
    expect(shouldNudge(evaluated({}), nudgeConfig)).toBe(true);
  });

  test("blocks no stop", () => {
    expect(kindsFor(view({ mergeQueue: QUEUED, mergeable: "CONFLICTING" }))).toEqual([]);
  });

  test("stored evaluations without queue fields still load", () => {
    const { mergeQueue: _entry, queueRemoval: _removal, ...legacy } = queued;
    expect(isEvaluation(legacy)).toBe(true);
    expect(isEvaluation(queued)).toBe(true);
  });
});
