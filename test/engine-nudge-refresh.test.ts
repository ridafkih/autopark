import { describe, expect, test } from "bun:test";
import { HEAD2, REPO, snapshot } from "./fixtures/build.ts";
import { createNudgeHarness, KEY, MINUTE, openThread } from "./fixtures/nudge-harness.ts";

const threads = { threads: [openThread] };

describe("a due nudge re-reads GitHub before it is sent", () => {
  test("a PR still blocked the same way is read once more and nudged", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    const before = harness.github.readsOf(REPO, 7);
    await harness.minutes(10);
    expect(harness.github.readsOf(REPO, 7)).toBe(before + 1);
    expect(harness.nudgeMinutes()).toEqual([10]);
  });

  test("a PR that turned ready without an event is not nudged", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.github.set(snapshot({ number: 7 }));
    await harness.minutes(10);
    expect(harness.nudges()).toEqual([]);
    expect(harness.store.getPullRequest(KEY)?.evaluation?.ready).toBe(true);
  });

  test("a PR merged without an event is not nudged", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.github.set(snapshot({ ...threads, number: 7, state: "MERGED" }));
    await harness.minutes(10);
    expect(harness.nudges()).toEqual([]);
    expect(harness.kinds()).toContain("merged");
  });

  test("a new head without an event restarts the clock instead of nudging", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.github.set(snapshot({ ...threads, number: 7, headSha: HEAD2 }));
    await harness.minutes(10);
    expect(harness.nudges()).toEqual([]);
    await harness.minutes(10);
    expect(harness.nudges().map((line) => line.head)).toEqual([HEAD2]);
  });
});

describe("an expiring hold re-reads GitHub before hold_expired is sent", () => {
  test("a PR merged during the hold gets no hold_expired", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.hold(KEY, 30 * MINUTE, "waiting on design");
    harness.github.set(snapshot({ ...threads, number: 7, state: "MERGED" }));
    await harness.minutes(30);
    expect(harness.linesOf("hold_expired")).toEqual([]);
  });

  test("a PR still blocked when the hold ends gets hold_expired", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.hold(KEY, 30 * MINUTE, "waiting on design");
    const before = harness.github.readsOf(REPO, 7);
    await harness.minutes(30);
    expect(harness.github.readsOf(REPO, 7)).toBeGreaterThan(before);
    expect(harness.linesOf("hold_expired")).toHaveLength(1);
  });
});
