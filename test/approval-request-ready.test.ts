import { describe, expect, test } from "bun:test";
import { check, HEAD, HEAD2, REPO } from "./fixtures/build.ts";
import { createNudgeHarness, KEY, openThread } from "./fixtures/nudge-harness.ts";
import { kindsFor, stopConfig, view } from "./fixtures/stop-views.ts";

const INSTRUCTION = "Ask the Chief Approval Officer to approve {url}.";
const FILLED = `Ask the Chief Approval Officer to approve https://github.com/${REPO}/pull/7.`;
const REASK = "the earlier request was made before the PR was reviewable; ask again now";
const whenReady = { reviewRequest: { instruction: INSTRUCTION, when: "ready" } };
const whenOpen = { reviewRequest: { instruction: INSTRUCTION } };
const unapproved = { approvals: [], reviewDecision: "REVIEW_REQUIRED" };
const draft = { ...unapproved, isDraft: true };
const pending = {
  ...unapproved,
  checks: [check("build", "pending"), check("gate", "pass", { isRequired: true })],
};
const threads = { ...unapproved, threads: [openThread] };
const stop = stopConfig.hooks.stop;

describe("reviewRequest.when: ready", () => {
  test("a draft PR gets no approval_needed", async () => {
    const harness = await createNudgeHarness(whenReady);
    await harness.trackWith(draft);
    await harness.minutes(30);
    expect(harness.linesOf("approval_needed")).toEqual([]);
  });

  test("a PR with open threads gets no approval_needed and no re-request nudge", async () => {
    const harness = await createNudgeHarness(whenReady);
    await harness.trackWith(threads);
    await harness.minutes(10);
    expect(harness.linesOf("approval_needed")).toEqual([]);
    const [nudge] = harness.nudges();
    expect(nudge?.data).toMatchObject({ reRequestReview: false, instruction: null });
    expect(nudge?.reason).not.toContain(FILLED);
  });

  test("asks once when the PR becomes reviewable", async () => {
    const harness = await createNudgeHarness(whenReady);
    await harness.trackWith(draft);
    await harness.show(unapproved);
    await harness.show({ ...unapproved, headSha: HEAD2 });
    const asks = harness.linesOf("approval_needed");
    expect(asks).toHaveLength(1);
    expect(asks[0]?.data).toMatchObject({ instruction: FILLED, reRequestReview: true });
    expect(asks[0]?.reason).not.toContain("without waiting for checks");
  });

  test("a request recorded while draft is asked again exactly once when reviewable", async () => {
    const harness = await createNudgeHarness(whenReady);
    await harness.trackWith(draft);
    harness.engine.markReviewRequested(REPO, 7, HEAD);
    expect(harness.store.getPullRequest(KEY)?.reviewRequestedReady).toBe(false);
    await harness.show(pending);
    expect(harness.linesOf("approval_needed")).toEqual([]);
    await harness.show(unapproved);
    await harness.show({ ...unapproved, headSha: HEAD2 });
    await harness.minutes(60);
    const asks = harness.linesOf("approval_needed");
    expect(asks).toHaveLength(1);
    expect(asks[0]?.reason).toContain(REASK);
    expect(asks[0]?.reason).toContain(FILLED);
    expect(asks[0]?.data).toMatchObject({ requestedEarly: true, reRequestReview: true });
  });

  test("a request recorded while reviewable is never re-asked after the head moves", async () => {
    const harness = await createNudgeHarness(whenReady);
    await harness.trackWith(unapproved);
    harness.engine.markReviewRequested(REPO, 7, HEAD);
    expect(harness.store.getPullRequest(KEY)?.reviewRequestedReady).toBe(true);
    await harness.show({ ...pending, headSha: HEAD2 });
    await harness.show({ ...unapproved, headSha: HEAD2 });
    await harness.minutes(60);
    expect(harness.linesOf("approval_needed")).toHaveLength(1);
    expect(harness.nudges()).toEqual([]);
  });

  test("the re-ask, once recorded while reviewable, is final", async () => {
    const harness = await createNudgeHarness(whenReady);
    await harness.trackWith(draft);
    harness.engine.markReviewRequested(REPO, 7, HEAD);
    await harness.show(unapproved);
    harness.engine.markReviewRequested(REPO, 7, HEAD);
    await harness.show({ ...unapproved, headSha: HEAD2 });
    await harness.minutes(60);
    expect(harness.linesOf("approval_needed")).toHaveLength(1);
    expect(harness.nudges()).toEqual([]);
  });

  test("a request recorded before readiness was known counts as early", async () => {
    const harness = await createNudgeHarness(whenReady);
    harness.store.track({ repo: REPO, number: 7, source: "filter", sessionId: null, now: 0 });
    harness.store.setReviewRequested(KEY, HEAD);
    expect(harness.store.getPullRequest(KEY)?.reviewRequestedReady).toBeNull();
    await harness.trackWith(unapproved);
    const asks = harness.linesOf("approval_needed");
    expect(asks).toHaveLength(1);
    expect(asks[0]?.reason).toContain(REASK);
  });

  test("the stop hook lists approval only once the PR is reviewable", () => {
    const early = { reviewRequestedHead: null };
    expect(kindsFor(view(pending, early), stop, "ready")).toEqual([]);
    expect(kindsFor(view(draft, early), stop, "ready")).toEqual([]);
    expect(kindsFor(view(unapproved, early), stop, "ready")).toEqual(["review_not_requested"]);
  });

  test("the stop hook lists a premature request again once reviewable", () => {
    const premature = { reviewRequestedHead: HEAD, reviewRequestedReady: false };
    const reviewable = { reviewRequestedHead: HEAD, reviewRequestedReady: true };
    expect(kindsFor(view(pending, premature), stop, "ready")).toEqual([]);
    expect(kindsFor(view(unapproved, premature), stop, "ready")).toEqual(["review_not_requested"]);
    expect(kindsFor(view(unapproved, reviewable), stop, "ready")).toEqual([]);
  });
});

describe("reviewRequest.when: open stays unchanged", () => {
  test("asks while checks are pending and never re-asks a draft-time request", async () => {
    const harness = await createNudgeHarness(whenOpen);
    await harness.trackWith(pending);
    expect(harness.linesOf("approval_needed")).toHaveLength(1);
    const other = await createNudgeHarness(whenOpen);
    await other.trackWith(draft);
    other.engine.markReviewRequested(REPO, 7, HEAD);
    await other.show(unapproved);
    await other.minutes(60);
    expect(other.linesOf("approval_needed")).toEqual([]);
    expect(other.nudges()).toEqual([]);
  });

  test("the stop hook ignores whether a request was premature", () => {
    const premature = { reviewRequestedHead: HEAD, reviewRequestedReady: false };
    expect(kindsFor(view(unapproved, premature), stop, "open")).toEqual([]);
    expect(kindsFor(view(pending, { reviewRequestedHead: null }), stop, "open")).toEqual([
      "review_not_requested",
    ]);
  });
});
