import { describe, expect, test } from "bun:test";
import { ALL_PULL_REQUESTS } from "../src/core/hold.ts";
import { PAUSE_RULE } from "../src/core/nudge-message.ts";
import { pullRequestKey } from "../src/core/types.ts";
import { REPO } from "./fixtures/build.ts";
import { createNudgeHarness, KEY, MINUTE, openThread } from "./fixtures/nudge-harness.ts";

const threads = { threads: [openThread] };

describe("holds", () => {
  test("a held PR does not nudge; expiry emits hold_expired and nudges at once", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.hold(KEY, 30 * MINUTE, "waiting on design");
    await harness.minutes(29);
    expect(harness.nudges()).toEqual([]);
    await harness.minutes(1);
    const [expired] = harness.linesOf("hold_expired");
    expect(expired?.data).toMatchObject({ holdReason: "waiting on design", scope: "pr" });
    expect(expired?.reason).toStartWith(PAUSE_RULE);
    expect(expired?.reason).toContain("1 unresolved review thread(s)");
    expect(harness.nudgeMinutes()).toEqual([30]);
    const kinds = harness.kinds().filter((kind) => kind === "hold_expired" || kind === "nudge");
    expect(kinds).toEqual(["hold_expired", "nudge"]);
    await harness.minutes(10);
    expect(harness.nudgeMinutes()).toEqual([30, 40]);
  });

  test("unhold resumes nudging straight away without hold_expired", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.hold(KEY, 30 * MINUTE, null);
    await harness.minutes(15);
    harness.engine.nudges.unhold(KEY);
    await harness.clock.advance(0);
    expect(harness.nudgeMinutes()).toEqual([15]);
    expect(harness.linesOf("hold_expired")).toEqual([]);
  });

  test("hold all covers every tracked PR and expires for each", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads, 7);
    await harness.trackWith(threads, 8);
    harness.engine.nudges.hold(ALL_PULL_REQUESTS, 20 * MINUTE, "lunch");
    await harness.minutes(19);
    expect(harness.nudges()).toEqual([]);
    await harness.minutes(1);
    const expired = harness.linesOf("hold_expired");
    expect(expired.map((line) => line.number)).toEqual([7, 8]);
    expect(expired[0]?.data.scope).toBe("all");
    expect(harness.nudges().map((line) => line.number)).toEqual([7, 8]);
  });

  test("a PR hold that ends while a hold on everything continues stays quiet", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.hold(KEY, 10 * MINUTE, null);
    harness.engine.nudges.hold(ALL_PULL_REQUESTS, 30 * MINUTE, null);
    await harness.minutes(29);
    expect(harness.linesOf("hold_expired")).toEqual([]);
    expect(harness.nudges()).toEqual([]);
    await harness.minutes(1);
    expect(harness.linesOf("hold_expired")).toHaveLength(1);
    expect(harness.nudgeMinutes()).toEqual([30]);
  });

  test("unhold all releases every hold", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.hold(KEY, 60 * MINUTE, null);
    harness.engine.nudges.hold(ALL_PULL_REQUESTS, 60 * MINUTE, null);
    harness.engine.nudges.unhold(ALL_PULL_REQUESTS);
    await harness.minutes(10);
    expect(harness.nudgeMinutes()).toEqual([10]);
  });

  test("a hold defaults to 30 minutes and refuses more than 4 hours", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    expect(harness.engine.nudges.hold(KEY).until).toBe(30 * MINUTE);
    expect(() => harness.engine.nudges.hold(KEY, 5 * 60 * MINUTE)).toThrow(/at most 4h/u);
    expect(() => harness.engine.nudges.hold(KEY, 0)).toThrow(/longer than 0/u);
  });

  test("holding an untracked PR is refused", async () => {
    const harness = await createNudgeHarness();
    expect(() => harness.engine.nudges.hold(pullRequestKey(REPO, 99))).toThrow(/not tracked/u);
  });

  test("status summaries carry the hold and the next nudge", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.hold(KEY, 45 * MINUTE, "design review");
    const [summary] = harness.engine.nudges.summaries(harness.engine.status());
    expect(summary).toMatchObject({
      hold: { until: 45 * MINUTE, reason: "design review", scope: "pr" },
      blockedSince: 0,
      nudges: 0,
      nextNudgeAt: 45 * MINUTE,
    });
  });
});
