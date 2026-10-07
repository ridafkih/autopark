import { describe, expect, test } from "bun:test";
import { PAUSE_RULE } from "../src/core/nudge-message.ts";
import { Engine } from "../src/daemon/engine.ts";
import { check, HEAD, HEAD2 } from "./fixtures/build.ts";
import { createNudgeHarness, MINUTE, openThread } from "./fixtures/nudge-harness.ts";

const threads = { threads: [openThread] };
const failing = {
  threads: [openThread],
  checks: [check("build", "fail"), check("gate", "pass", { isRequired: true })],
};

describe("nudges", () => {
  test("the first nudge lands once the PR has been blocked for `after`", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    await harness.minutes(9);
    expect(harness.nudges()).toEqual([]);
    await harness.minutes(1);
    expect(harness.nudgeMinutes()).toEqual([10]);
    const [nudge] = harness.nudges();
    expect(nudge?.head).toBe(HEAD);
    expect(nudge?.data).toMatchObject({
      kinds: ["threads_open"],
      reasons: [{ code: "threads_open", detail: "1 unresolved review thread(s)" }],
      blockedForMs: 10 * MINUTE,
      blockedFor: "10m",
      count: 1,
      escalated: false,
    });
    expect(nudge?.reason).toStartWith(PAUSE_RULE);
    expect(nudge?.reason).toContain("blocked for 10m");
  });

  test("it repeats every `every` while the same reasons block", async () => {
    const harness = await createNudgeHarness({ nudge: { after: "10m", every: "5m" } });
    await harness.trackWith(threads);
    await harness.minutes(25);
    expect(harness.nudgeMinutes()).toEqual([10, 15, 20, 25]);
    expect(harness.nudges().map((line) => line.data.count)).toEqual([1, 2, 3, 4]);
  });

  test("a change in the blocking reasons restarts the clock", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    await harness.minutes(5);
    await harness.show(failing);
    await harness.minutes(9);
    expect(harness.nudges()).toEqual([]);
    await harness.minutes(1);
    expect(harness.nudgeMinutes()).toEqual([15]);
    expect(harness.nudges()[0]?.data.kinds).toEqual(["checks_failed", "threads_open"]);
  });

  test("a head that moved within `after` keeps it quiet", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    await harness.minutes(8);
    await harness.show({ ...threads, headSha: HEAD2 });
    await harness.minutes(9);
    expect(harness.nudges()).toEqual([]);
    await harness.minutes(1);
    expect(harness.nudgeMinutes()).toEqual([18]);
  });

  test("quietWhenHeadMoving off nudges on schedule despite a new head", async () => {
    const harness = await createNudgeHarness({ nudge: { quietWhenHeadMoving: false } });
    await harness.trackWith(threads);
    await harness.minutes(8);
    await harness.show({ ...threads, headSha: HEAD2 });
    await harness.minutes(2);
    expect(harness.nudgeMinutes()).toEqual([10]);
  });

  test.each([
    ["a draft", { ...threads, isDraft: true }],
    ["a ready PR", {}],
  ])("%s never nudges", async (label, changes) => {
    const harness = await createNudgeHarness();
    await harness.trackWith(changes);
    await harness.minutes(60);
    expect(harness.nudges()).toEqual([]);
    expect(harness.clock.pending).toBe(0);
  });

  test("a ready but unmerged PR nudges when nudgeReadyUnmerged is on", async () => {
    const harness = await createNudgeHarness({ nudge: { nudgeReadyUnmerged: true } });
    await harness.trackWith({});
    await harness.minutes(10);
    expect(harness.nudgeMinutes()).toEqual([10]);
    expect(harness.nudges()[0]?.reason).toContain("ready for 10m and not merged");
  });

  test("kinds narrows which reasons nudge", async () => {
    const harness = await createNudgeHarness({ nudge: { kinds: ["checks_failed"] } });
    await harness.trackWith(threads);
    await harness.minutes(30);
    expect(harness.nudges()).toEqual([]);
  });

  test("escalateAfter marks later nudges as escalated and louder", async () => {
    const harness = await createNudgeHarness({ nudge: { escalateAfter: "30m" } });
    await harness.trackWith(threads);
    await harness.minutes(40);
    expect(harness.nudges().map((line) => line.data.escalated)).toEqual([false, false, true, true]);
    expect(harness.nudges()[1]?.reason).not.toContain("ESCALATED");
    expect(harness.nudges()[2]?.reason).toContain("ESCALATED: blocked for 30m");
  });

  test("awaiting_human tells the session to re-request review with the instruction", async () => {
    const harness = await createNudgeHarness({
      reviewRequest: { instruction: "Ask Cortana to approve {url} at {head}." },
    });
    await harness.trackWith({ approvals: [] });
    await harness.minutes(10);
    const [nudge] = harness.nudges();
    const instruction = `Ask Cortana to approve https://github.com/acme/widgets/pull/7 at ${HEAD}.`;
    expect(nudge?.data).toMatchObject({
      kinds: ["approval_missing", "awaiting_human"],
      reRequestReview: true,
      instruction,
    });
    expect(nudge?.reason).toContain("awaiting human review for 10m");
    expect(nudge?.reason).toContain(`re-request review: ${instruction}`);
  });

  test("awaiting_human with a review command points at request-review", async () => {
    const harness = await createNudgeHarness({ reviewRequest: { command: "ping-reviewers" } });
    await harness.trackWith({ approvals: [] });
    await harness.minutes(10);
    expect(harness.nudges()[0]?.reason).toContain(
      "re-request review: run `autopark request-review acme/widgets#7`",
    );
  });

  test("awaiting_human without a review request configured asks the user", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith({ approvals: [] });
    await harness.minutes(10);
    expect(harness.nudges()[0]?.data.reRequestReview).toBe(false);
    expect(harness.nudges()[0]?.reason).toContain("ask the user who reviews");
  });

  test("one timer for the next nudge is recomputed when state changes", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    expect(harness.clock.sleeps).toEqual([10 * MINUTE]);
    await harness.minutes(5);
    await harness.show(failing);
    expect(harness.clock.pending).toBe(1);
    await harness.minutes(5);
    expect(harness.nudges()).toEqual([]);
    expect(harness.clock.sleeps).toEqual([10 * MINUTE, 5 * MINUTE]);
    await harness.minutes(5);
    expect(harness.nudgeMinutes()).toEqual([15]);
    expect(harness.clock.pending).toBe(1);
  });

  test("a PR that turns ready drops its pending nudge", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    await harness.minutes(3);
    await harness.show({});
    await harness.minutes(60);
    expect(harness.nudges()).toEqual([]);
    expect(harness.clock.pending).toBe(0);
  });

  test("a restarted engine nudges an overdue PR at once", async () => {
    const harness = await createNudgeHarness();
    await harness.trackWith(threads);
    harness.engine.nudges.stop();
    harness.clock.jump(25 * MINUTE);
    const restarted = new Engine({ ...harness, clock: harness.clock });
    restarted.nudges.start();
    await harness.clock.advance(0);
    expect(harness.nudgeMinutes()).toEqual([25]);
    expect(harness.nudges()[0]?.data.blockedForMs).toBe(25 * MINUTE);
  });
});
