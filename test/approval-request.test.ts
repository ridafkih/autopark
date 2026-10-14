import { describe, expect, test } from "bun:test";
import { pullRequestKey } from "../src/core/types.ts";
import { normalizePullRequest } from "../src/github/snapshot.ts";
import { check, HEAD, HEAD2, OLD, REPO } from "./fixtures/build.ts";
import { createNudgeHarness, KEY, openThread } from "./fixtures/nudge-harness.ts";
import { reasonCodes } from "./fixtures/reason-table.ts";
import { kindsFor, view } from "./fixtures/stop-views.ts";

const INSTRUCTION = "Ask the Chief Approval Officer to approve {url}.";
const FILLED = `Ask the Chief Approval Officer to approve https://github.com/${REPO}/pull/7.`;
const reviewRequest = { reviewRequest: { instruction: INSTRUCTION } };
const behind = { mergeStateStatus: "BEHIND" };
const threads = { threads: [openThread] };
const pending = {
  checks: [check("build", "pending"), check("gate", "pass", { isRequired: true })],
};
const unapproved = { approvals: [], reviewDecision: "REVIEW_REQUIRED" };
const persisted = {
  approvals: [{ login: "reviewer", state: "APPROVED", sha: OLD }],
  reviewDecision: "APPROVED",
};

describe("approval truth", () => {
  test("a review decision of APPROVED satisfies approval even from an older commit", () => {
    expect(reasonCodes(persisted)).toEqual([]);
  });

  test("a review decision that is not APPROVED blocks even with an approval on head", () => {
    const changes = {
      approvals: [{ login: "reviewer", state: "APPROVED", sha: HEAD }],
      reviewDecision: "REVIEW_REQUIRED",
    };
    expect(reasonCodes(changes)).toEqual(["approval_missing"]);
  });

  test("bot approvals are dropped when reading GitHub", () => {
    const raw = {
      number: 7,
      headRefOid: HEAD,
      reviewDecision: "REVIEW_REQUIRED",
      latestOpinionatedReviews: {
        nodes: [
          {
            author: { __typename: "Bot", login: "ando-approver" },
            state: "APPROVED",
            commit: { oid: HEAD },
          },
          { author: { __typename: "User", login: "aj" }, state: "APPROVED", commit: { oid: OLD } },
        ],
      },
    };
    const snapshot = normalizePullRequest(REPO, raw);
    expect(snapshot.reviewDecision).toBe("REVIEW_REQUIRED");
    expect(snapshot.approvals.map((approval) => approval.login)).toEqual(["aj"]);
    expect(reasonCodes({ ...unapproved, approvals: snapshot.approvals })).toEqual([
      "approval_missing",
    ]);
  });
});

describe("asking for approval", () => {
  test("asks once as soon as the PR opens, before checks are green", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith({ ...unapproved, ...behind, ...pending });
    const asks = harness.linesOf("approval_needed");
    expect(asks).toHaveLength(1);
    expect(asks[0]?.data).toMatchObject({ instruction: FILLED, reRequestReview: true });
    expect(asks[0]?.reason).toContain(FILLED);
  });

  test("never asks again after a push or a main merge", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith({ ...unapproved, ...behind });
    await harness.show({ ...unapproved, headSha: HEAD2 });
    await harness.show({ ...unapproved, headSha: HEAD2, ...pending });
    expect(harness.linesOf("approval_needed")).toHaveLength(1);
  });

  test("does not ask when GitHub already reports the PR approved", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith({ ...persisted, headSha: HEAD2 });
    expect(harness.linesOf("approval_needed")).toEqual([]);
    expect(harness.linesOf("approval_stale")).toEqual([]);
  });

  test("does not ask when a request was already recorded", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    harness.store.track({ repo: REPO, number: 7, source: "filter", sessionId: null, now: 0 });
    harness.store.setReviewRequested(KEY, OLD);
    await harness.trackWith(unapproved);
    expect(harness.linesOf("approval_needed")).toEqual([]);
  });

  test("does not ask for a draft", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith({ ...unapproved, isDraft: true });
    expect(harness.linesOf("approval_needed")).toEqual([]);
  });

  test("a nudge carries the approval instruction while other blockers remain", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith({ ...unapproved, ...threads });
    await harness.minutes(10);
    const [nudge] = harness.nudges();
    expect(nudge?.data).toMatchObject({ reRequestReview: true, instruction: FILLED });
    expect(nudge?.reason).toContain(FILLED);
  });

  test("after the request is recorded nudges stop re-asking", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith({ ...unapproved, ...threads });
    harness.engine.markReviewRequested(REPO, 7, HEAD);
    await harness.minutes(10);
    const [nudge] = harness.nudges();
    expect(nudge?.data).toMatchObject({ kinds: ["threads_open", "approval_missing"] });
    expect(nudge?.data).toMatchObject({ reRequestReview: false, instruction: null });
    expect(nudge?.reason).not.toContain(FILLED);
  });

  test("a PR waiting only on a requested approval is not nudged", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith(unapproved);
    harness.engine.markReviewRequested(REPO, 7, HEAD);
    await harness.show({ ...unapproved, headSha: HEAD2 });
    await harness.minutes(60);
    expect(harness.nudges()).toEqual([]);
    expect(harness.store.getPullRequest(pullRequestKey(REPO, 7))?.reviewRequestedHead).toBe(HEAD);
  });

  test("a green PR awaiting approval with no request is nudged after `after`", async () => {
    const harness = await createNudgeHarness(reviewRequest);
    await harness.trackWith(unapproved);
    await harness.minutes(10);
    expect(harness.nudgeMinutes()).toEqual([10]);
    expect(harness.nudges()[0]?.data.instruction).toBe(FILLED);
  });
});

describe("stop hook review request", () => {
  test("blocks when approval is needed and review was never requested, even before green", () => {
    const tracked = view({ ...unapproved, ...pending }, { reviewRequestedHead: null });
    expect(kindsFor(tracked)).toEqual(["review_not_requested"]);
  });

  test("does not block after a request, even when the head moved", () => {
    const tracked = view({ ...unapproved, headSha: HEAD2 }, { reviewRequestedHead: HEAD });
    expect(kindsFor(tracked)).toEqual([]);
  });
});
