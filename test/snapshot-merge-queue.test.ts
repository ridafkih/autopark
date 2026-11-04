import { describe, expect, test } from "bun:test";
import { PULL_REQUEST_SNAPSHOT_QUERY } from "../src/github/query.ts";
import { normalizePullRequest } from "../src/github/snapshot.ts";
import { REPO } from "./fixtures/build.ts";

const QUEUED = { state: "AWAITING_CHECKS", position: 6, enqueuedAt: "2026-11-04T21:45:11Z" };

describe("normalizePullRequest reads the merge queue", () => {
  const base = { number: 7, state: "OPEN", headRefOid: "abc" };

  test("maps the entry and the newest removal", () => {
    const pullRequest = normalizePullRequest(REPO, {
      ...base,
      mergeQueueEntry: QUEUED,
      queueRemovals: {
        nodes: [{ reason: "FAILED_CHECKS", createdAt: "2026-11-04T20:00:00Z" }],
      },
    });
    expect(pullRequest.mergeQueue).toEqual(QUEUED);
    expect(pullRequest.queueRemoval).toEqual({
      reason: "FAILED_CHECKS",
      at: "2026-11-04T20:00:00Z",
    });
  });

  test("an unqueued PR has no entry", () => {
    const pullRequest = normalizePullRequest(REPO, { ...base, mergeQueueEntry: null });
    expect(pullRequest.mergeQueue).toBeNull();
    expect(pullRequest.queueRemoval).toBeNull();
  });
});

describe("snapshot query reads the merge queue in the same call", () => {
  test("asks for the entry and the newest removal", () => {
    expect(PULL_REQUEST_SNAPSHOT_QUERY).toContain("mergeQueueEntry { state position enqueuedAt }");
    expect(PULL_REQUEST_SNAPSHOT_QUERY).toContain(
      "queueRemovals: timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT])",
    );
  });
});
