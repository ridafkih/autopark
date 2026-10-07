import { describe, expect, test } from "bun:test";
import { REPO, snapshot } from "./fixtures/build.ts";
import { FakeClock } from "./fixtures/clock.ts";
import { createHarness } from "./fixtures/harness.ts";
import { ImmediateClock } from "./fixtures/immediate-clock.ts";
import { reviewDelivery } from "./fixtures/review-delivery.ts";

const unknownSnapshot = () => snapshot({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" });

describe("delivery dedupe", () => {
  test.each([
    ["one delivery", ["d1"], 1],
    ["same delivery redelivered", ["d1", "d1"], 1],
    ["three distinct deliveries", ["d1", "d2", "d3"], 3],
    ["interleaved redeliveries", ["d1", "d2", "d1", "d2", "d3"], 3],
  ] as const)("%s", async (label, ids, recomputes) => {
    const harness = await createHarness();
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    const before = harness.github.readsOf(REPO, 7);
    const accepted: boolean[] = [];
    for (const id of ids) {
      const result = await harness.engine.handleDelivery(reviewDelivery(id));
      accepted.push(result.accepted);
      await harness.engine.idle();
    }
    expect(harness.github.readsOf(REPO, 7) - before).toBe(recomputes);
    expect(accepted.filter(Boolean).length).toBe(recomputes);
  });
});

describe("mergeability UNKNOWN backoff", () => {
  test.each([
    ["resolved on first read", 0, [], false],
    ["resolved after one retry", 1, [1000], false],
    ["resolved after three retries", 3, [1000, 2000, 4000], false],
    ["resolved on the last retry", 6, [1000, 2000, 4000, 8000, 16_000, 30_000], false],
    ["never resolves", 9, [1000, 2000, 4000, 8000, 16_000, 30_000], true],
  ] as const)("%s", async (label, unknownReads, sleeps, isExhausted) => {
    const clock = new ImmediateClock();
    const harness = await createHarness({ clock });
    const settled =
      unknownReads > 6
        ? unknownSnapshot()
        : snapshot({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });
    const sequence = [...Array.from({ length: unknownReads }, unknownSnapshot), settled];
    harness.github.script(...sequence);
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    expect(clock.sleeps).toEqual([...sleeps]);
    expect(harness.github.readsOf(REPO, 7)).toBe(sleeps.length + 1);
    expect(harness.kinds().includes("mergeability_unknown")).toBe(isExhausted);
    expect(harness.kinds().includes("conflicted")).toBe(!isExhausted);
  });

  test("closed PRs never back off", async () => {
    const clock = new ImmediateClock();
    const harness = await createHarness({ clock });
    harness.github.set(snapshot({ state: "MERGED", mergeable: "UNKNOWN" }));
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    expect(clock.sleeps).toEqual([]);
  });

  test("nothing sleeps or reads until an event arrives", async () => {
    const clock = new FakeClock();
    const harness = await createHarness({ clock });
    harness.github.set(unknownSnapshot());
    await clock.advance(120_000);
    expect(clock.sleeps).toEqual([]);
    expect(harness.github.readsOf(REPO, 7)).toBe(0);
  });

  test("backoff waits on the injected clock between reads", async () => {
    const clock = new FakeClock();
    const harness = await createHarness({ clock });
    harness.github.script(unknownSnapshot(), unknownSnapshot(), snapshot());
    harness.engine.track(REPO, 7);
    await clock.advance(0);
    expect(harness.github.readsOf(REPO, 7)).toBe(1);
    await clock.advance(999);
    expect(harness.github.readsOf(REPO, 7)).toBe(1);
    await clock.advance(1);
    expect(harness.github.readsOf(REPO, 7)).toBe(2);
    await clock.advance(2000);
    expect(harness.github.readsOf(REPO, 7)).toBe(3);
    await harness.engine.idle();
    expect(harness.kinds()).toContain("ready");
  });
});
