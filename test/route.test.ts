import { describe, expect, test } from "bun:test";
import { route, type PullRequestIndex } from "../src/core/route.ts";
import { matchesTrackFilter } from "../src/core/track.ts";

const index: PullRequestIndex = {
  bySha: (repo, sha) => (repo === "acme/widgets" && sha === "abc" ? [7] : []),
  byHeadRef: (repo, ref) => (repo === "acme/widgets" && ref === "bot/tidy" ? [7] : []),
  byBaseRef: (repo, ref) =>
    repo === "acme/widgets" && ref === "main"
      ? [7, 8]
      : repo === "acme/widgets" && ref === "release"
        ? [9]
        : [],
};

const repository = { full_name: "Acme/Widgets" };
const pr = {
  number: 7,
  user: { login: "octo" },
  head: { ref: "bot/tidy", sha: "abc" },
  base: { ref: "main" },
  labels: [{ name: "autopilot" }],
};

type Row = [string, string, Record<string, unknown>, number[], boolean];

describe("route", () => {
  test.each<Row>([
    [
      "pull_request opened",
      "pull_request",
      { action: "opened", pull_request: pr, repository },
      [7],
      true,
    ],
    [
      "pull_request synchronize",
      "pull_request",
      { action: "synchronize", pull_request: pr, repository },
      [7],
      true,
    ],
    [
      "pull_request closed",
      "pull_request",
      { action: "closed", pull_request: pr, repository },
      [7],
      true,
    ],
    [
      "review submitted",
      "pull_request_review",
      { action: "submitted", pull_request: pr, repository },
      [7],
      true,
    ],
    [
      "review comment",
      "pull_request_review_comment",
      { action: "created", pull_request: pr, repository },
      [7],
      true,
    ],
    [
      "thread resolved",
      "pull_request_review_thread",
      { action: "resolved", pull_request: pr, repository },
      [7],
      true,
    ],
    [
      "comment on a PR",
      "issue_comment",
      { action: "edited", issue: { number: 7, pull_request: {} }, repository },
      [7],
      false,
    ],
    [
      "comment on an issue",
      "issue_comment",
      { action: "created", issue: { number: 3 }, repository },
      [],
      false,
    ],
    [
      "check run with PR list",
      "check_run",
      {
        action: "completed",
        check_run: { head_sha: "zzz", pull_requests: [{ number: 11 }] },
        repository,
      },
      [11],
      false,
    ],
    [
      "check run mapped by sha",
      "check_run",
      { action: "completed", check_run: { head_sha: "abc", pull_requests: [] }, repository },
      [7],
      false,
    ],
    [
      "check run on both deduped",
      "check_run",
      {
        action: "completed",
        check_run: { head_sha: "abc", pull_requests: [{ number: 7 }] },
        repository,
      },
      [7],
      false,
    ],
    [
      "check suite by sha",
      "check_suite",
      { action: "completed", check_suite: { head_sha: "abc", pull_requests: [] }, repository },
      [7],
      false,
    ],
    ["status by sha", "status", { sha: "abc", state: "failure", repository }, [7], false],
    [
      "push to base rechecks every PR on that base",
      "push",
      { ref: "refs/heads/main", repository },
      [7, 8],
      false,
    ],
    ["push to another base", "push", { ref: "refs/heads/release", repository }, [9], false],
    [
      "push to a tracked head branch",
      "push",
      { ref: "refs/heads/bot/tidy", repository },
      [7],
      false,
    ],
    ["tag push is ignored", "push", { ref: "refs/tags/v1", repository }, [], false],
    [
      "branch deletion is ignored",
      "push",
      { ref: "refs/heads/main", deleted: true, repository },
      [],
      false,
    ],
    ["ping is ignored", "ping", { zen: "hi", repository }, [], false],
    ["unknown event is ignored", "star", { action: "created", repository }, [], false],
  ])("%s", (...row: Row) => {
    const [, event, payload, prs, hasCandidate] = row;
    const r = route(event, payload, index);
    expect(r.pullRequests).toEqual(prs);
    expect(r.candidates.length > 0).toBe(hasCandidate);
    if (prs.length) expect(r.repo).toBe("acme/widgets");
  });

  test("candidate carries the fields the track filter needs", () => {
    const r = route("pull_request", { action: "opened", pull_request: pr, repository }, index);
    expect(r.candidates[0]).toEqual({
      repo: "acme/widgets",
      number: 7,
      author: "octo",
      headRef: "bot/tidy",
      baseRef: "main",
      labels: ["autopilot"],
      open: true,
    });
  });

  test("payload without repository routes nowhere", () => {
    expect(route("push", { ref: "refs/heads/main" }, index).pullRequests).toEqual([]);
  });
});

const cand = {
  repo: "acme/widgets",
  number: 7,
  author: "octo",
  headRef: "bot/tidy",
  baseRef: "main",
  labels: ["autopilot"],
  open: true,
};

describe("track filter", () => {
  test.each([
    ["no filters tracks nothing", {}, false],
    ["author match", { authors: ["octo"] }, true],
    ["author is case-insensitive", { authors: ["OCTO"] }, true],
    ["@me resolves to the viewer", { authors: ["@me"] }, true],
    ["author mismatch", { authors: ["someone"] }, false],
    ["branch prefix match", { branchPrefixes: ["bot/"] }, true],
    ["branch prefix mismatch", { branchPrefixes: ["feature/"] }, false],
    ["label match", { labels: ["autopilot"] }, true],
    ["label mismatch", { labels: ["other"] }, false],
    ["all dimensions must match", { authors: ["octo"], branchPrefixes: ["feature/"] }, false],
    [
      "any value within a dimension matches",
      { authors: ["x", "octo"], branchPrefixes: ["feature/", "bot/"] },
      true,
    ],
  ])("%s", (_l, filter, expected) => {
    const f = { authors: [], branchPrefixes: [], labels: [], ...filter };
    expect(matchesTrackFilter(cand, f, "octo")).toBe(expected);
  });

  test("closed candidates never auto-track", () => {
    expect(
      matchesTrackFilter(
        { ...cand, open: false },
        { authors: ["octo"], branchPrefixes: [], labels: [] },
        "octo",
      ),
    ).toBe(false);
  });
});
