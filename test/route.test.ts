import { describe, expect, test } from "bun:test";
import { route, type PullRequestIndex } from "../src/core/route.ts";

const REPO = "acme/widgets";
const PULL_REQUESTS_BY_BASE = new Map([
  ["main", [7, 8]],
  ["release", [9]],
]);

const index: PullRequestIndex = {
  bySha: (repo, sha) => (repo === REPO && sha === "abc" ? [7] : []),
  byHeadRef: (repo, ref) => (repo === REPO && ref === "bot/tidy" ? [7] : []),
  byBaseRef: (repo, ref) => (repo === REPO ? (PULL_REQUESTS_BY_BASE.get(ref) ?? []) : []),
};

const repository = { full_name: "Acme/Widgets" };
const pullRequest = {
  number: 7,
  user: { login: "octo" },
  head: { ref: "bot/tidy", sha: "abc" },
  base: { ref: "main" },
  labels: [{ name: "autopark" }],
};

interface Expected {
  pullRequests: number[];
  hasCandidate: boolean;
}

type Row = [string, string, Record<string, unknown>, Expected];

const routed = (pullRequests: number[], hasCandidate = false): Expected => ({
  pullRequests,
  hasCandidate,
});

const pullRequestEvent = (action: string) => ({ action, pull_request: pullRequest, repository });

describe("route", () => {
  test.each<Row>([
    ["pull_request opened", "pull_request", pullRequestEvent("opened"), routed([7], true)],
    [
      "pull_request synchronize",
      "pull_request",
      pullRequestEvent("synchronize"),
      routed([7], true),
    ],
    ["pull_request closed", "pull_request", pullRequestEvent("closed"), routed([7], true)],
    ["review submitted", "pull_request_review", pullRequestEvent("submitted"), routed([7], true)],
    [
      "review comment",
      "pull_request_review_comment",
      pullRequestEvent("created"),
      routed([7], true),
    ],
    [
      "thread resolved",
      "pull_request_review_thread",
      pullRequestEvent("resolved"),
      routed([7], true),
    ],
    [
      "comment on a PR",
      "issue_comment",
      { action: "edited", issue: { number: 7, pull_request: {} }, repository },
      routed([7]),
    ],
    [
      "comment on an issue",
      "issue_comment",
      { action: "created", issue: { number: 3 }, repository },
      routed([]),
    ],
    [
      "check run with PR list",
      "check_run",
      {
        action: "completed",
        check_run: { head_sha: "zzz", pull_requests: [{ number: 11 }] },
        repository,
      },
      routed([11]),
    ],
    [
      "check run mapped by sha",
      "check_run",
      { action: "completed", check_run: { head_sha: "abc", pull_requests: [] }, repository },
      routed([7]),
    ],
    [
      "check run on both deduped",
      "check_run",
      {
        action: "completed",
        check_run: { head_sha: "abc", pull_requests: [{ number: 7 }] },
        repository,
      },
      routed([7]),
    ],
    [
      "check suite by sha",
      "check_suite",
      { action: "completed", check_suite: { head_sha: "abc", pull_requests: [] }, repository },
      routed([7]),
    ],
    ["status by sha", "status", { sha: "abc", state: "failure", repository }, routed([7])],
    [
      "push to base rechecks every PR on that base",
      "push",
      { ref: "refs/heads/main", repository },
      routed([7, 8]),
    ],
    ["push to another base", "push", { ref: "refs/heads/release", repository }, routed([9])],
    [
      "push to a tracked head branch",
      "push",
      { ref: "refs/heads/bot/tidy", repository },
      routed([7]),
    ],
    ["tag push is ignored", "push", { ref: "refs/tags/v1", repository }, routed([])],
    [
      "branch deletion is ignored",
      "push",
      { ref: "refs/heads/main", deleted: true, repository },
      routed([]),
    ],
    ["ping is ignored", "ping", { zen: "hi", repository }, routed([])],
    ["unknown event is ignored", "star", { action: "created", repository }, routed([])],
  ])("%s", (label, event, payload, expected) => {
    const result = route(event, payload, index);
    expect(result.pullRequests).toEqual(expected.pullRequests);
    expect(result.candidates.length > 0).toBe(expected.hasCandidate);
    if (expected.pullRequests.length > 0) expect(result.repo).toBe(REPO);
  });

  test("candidate carries the fields the track filter needs", () => {
    const [candidate] = route("pull_request", pullRequestEvent("opened"), index).candidates;
    expect(candidate).toEqual({
      repo: REPO,
      number: 7,
      author: "octo",
      headRef: "bot/tidy",
      baseRef: "main",
      labels: ["autopark"],
      open: true,
    });
  });

  test("payload without repository routes nowhere", () => {
    expect(route("push", { ref: "refs/heads/main" }, index).pullRequests).toEqual([]);
  });
});
