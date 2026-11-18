import { describe, expect, test } from "bun:test";
import { diff } from "../src/core/transitions.ts";
import type { MergeQueueEntry } from "../src/core/types.ts";
import { evaluateChanges, transitionTable, unapproved } from "./fixtures/transition-table.ts";
import { check } from "./fixtures/build.ts";

const queued = (position = 3, state = "AWAITING_CHECKS"): { mergeQueue: MergeQueueEntry } => ({
  mergeQueue: { state, position, enqueuedAt: "2026-11-04T21:45:11Z" },
});

const pending = { checks: [check("build", "pending"), check("gate", "pass")] };

const removed = (reason: string, removedAt = "2026-11-04T22:00:00Z") => ({
  queueRemoval: { reason, at: removedAt },
});

const isQueueKind = (kind: string) => QUEUE_KINDS.some((queueKind) => queueKind === kind);

const QUEUE_KINDS = [
  "queued",
  "dequeued",
  "merged",
  "closed",
  "ready",
  "not_ready",
  "awaiting_human",
  "mergeability_unknown",
] as const;

transitionTable(
  "transition: merge queue",
  [...QUEUE_KINDS],
  [
    ["ready PR enters the queue", {}, queued(), ["queued"]],
    ["first sight of a queued PR", null, queued(), ["queued"]],
    ["moving up the queue is quiet", queued(5), queued(2), []],
    ["readiness flips while queued are quiet", { ...queued(), ...pending }, queued(), []],
    ["not ready while queued is quiet", queued(), { ...queued(), ...pending }, []],
    [
      "awaiting human while queued is quiet",
      { ...queued(), ...pending },
      { ...queued(), ...unapproved },
      [],
    ],
    [
      "unknown mergeability while queued is folded into the queue",
      { ...queued(), mergeable: "MERGEABLE" },
      { ...queued(), mergeable: "UNKNOWN" },
      [],
      { exhausted: true },
    ],
    ["removed from the queue", queued(), removed("REMOVED"), ["dequeued"]],
    ["queued then merged", queued(1), { state: "MERGED" }, ["merged"]],
  ],
);

describe("merge queue transition data", () => {
  test("queued carries the position and state", () => {
    const previous = evaluateChanges({});
    const next = evaluateChanges(queued(6), previous);
    const transition = diff(previous, next).find((entry) => entry.kind === "queued");
    expect(transition?.data).toEqual({
      state: "AWAITING_CHECKS",
      position: 6,
      enqueuedAt: "2026-11-04T21:45:11Z",
    });
    expect(transition?.reason).toBe("entered the merge queue at position 6 (AWAITING_CHECKS)");
  });

  test("dequeued carries GitHub's removal reason when it happened after enqueue", () => {
    const previous = evaluateChanges(queued());
    const next = evaluateChanges(removed("FAILED_CHECKS"), previous);
    const transition = diff(previous, next).find((entry) => entry.kind === "dequeued");
    expect(transition?.data).toEqual({ reason: "FAILED_CHECKS", lastState: "AWAITING_CHECKS" });
    expect(transition?.reason).toBe("left the merge queue without merging: FAILED_CHECKS");
  });

  test("a removal older than the enqueue is not the reason", () => {
    const previous = evaluateChanges(queued());
    const next = evaluateChanges(removed("MANUAL", "2026-11-01T00:00:00Z"), previous);
    const transition = diff(previous, next).find((entry) => entry.kind === "dequeued");
    expect(transition?.data).toEqual({ reason: null, lastState: "AWAITING_CHECKS" });
    expect(transition?.reason).toBe("left the merge queue without merging");
  });

  test("leaving the queue reports dequeued, not ready", () => {
    const previous = evaluateChanges({ ...queued(), ...pending });
    const next = evaluateChanges(removed("MANUAL"), previous);
    const kinds = diff(previous, next)
      .map((entry) => entry.kind)
      .filter(isQueueKind);
    expect(kinds).toEqual(["dequeued"]);
  });
});
