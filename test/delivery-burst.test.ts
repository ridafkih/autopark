import { afterEach, describe, expect, test } from "bun:test";
import type { TransitionKind } from "../src/core/types.ts";
import { REPO } from "./fixtures/build.ts";
import {
  closers,
  deliver,
  kindsOf,
  metaAt,
  metaOf,
  unapproved,
  world,
} from "./fixtures/delivery-world.ts";

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("a burst for one PR collapses to its newest state", () => {
  test("every intermediate transition folds into the newest one", async () => {
    const current = world();
    current.show({ state: "MERGED" });
    const kinds: TransitionKind[] = [
      "head_moved",
      "not_ready",
      "review_scored",
      "checks_passed",
      "ready",
      "queued",
      "merged",
    ];
    const deliveries = await deliver(
      current,
      kinds.map((kind, index) => ({ id: index + 1, kind })),
    );
    expect(deliveries).toHaveLength(1);
    expect(metaAt(deliveries, 0)).toMatchObject({
      kind: "merged",
      transition_id: "7",
      superseded: "head_moved,not_ready,review_scored,checks_passed,ready,queued",
    });
  });

  test("an instruction that still holds is kept beside the newest state", async () => {
    const current = world();
    current.show(unapproved);
    const deliveries = await deliver(current, [
      { id: 1, kind: "approval_needed" },
      { id: 2, kind: "head_moved" },
      { id: 3, kind: "not_ready" },
    ]);
    expect(kindsOf(deliveries)).toEqual(["approval_needed", "not_ready"]);
    expect(metaAt(deliveries, 1).superseded).toBe("head_moved");
  });

  test("bursts for different PRs collapse separately", async () => {
    const current = world();
    current.store.track({ repo: REPO, number: 10, source: "explicit", sessionId: "s1", now: 1 });
    const deliveries = await deliver(current, [
      { id: 1, kind: "head_moved", number: 7 },
      { id: 2, kind: "head_moved", number: 10 },
      { id: 3, kind: "checks_failed", number: 7 },
      { id: 4, kind: "checks_passed", number: 10 },
    ]);
    expect(deliveries.map((delivery) => metaOf(delivery).transition_id)).toEqual(["3", "4"]);
  });

  test("a lone live transition is delivered as is", async () => {
    const current = world();
    const deliveries = await deliver(current, [{ id: 1, kind: "checks_failed" }]);
    expect(metaAt(deliveries, 0).superseded).toBeUndefined();
  });
});
