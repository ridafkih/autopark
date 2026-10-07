import { describe, expect, test } from "bun:test";
import type { GraphQLPullRequest } from "../src/github/graphql-types.ts";
import { checkRunOutcome, normalizePullRequest, statusOutcome } from "../src/github/snapshot.ts";

const RAW: GraphQLPullRequest = {
  number: 7,
  title: "Tidy",
  url: "https://github.com/acme/widgets/pull/7",
  state: "OPEN",
  isDraft: false,
  headRefName: "bot/tidy",
  baseRefName: "main",
  headRefOid: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
  baseRef: { target: { oid: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" } },
  author: { login: "octo" },
  labels: { nodes: [{ name: "autopilot" }] },
  mergeable: "CONFLICTING",
  mergeStateStatus: "DIRTY",
  latestOpinionatedReviews: {
    nodes: [
      {
        author: { login: "r" },
        state: "APPROVED",
        commit: { oid: "ABCDEF1234567890ABCDEF1234567890ABCDEF12" },
      },
    ],
  },
  reviewThreads: {
    nodes: [
      {
        id: "T1",
        isResolved: false,
        isOutdated: true,
        path: "a.ts",
        comments: { nodes: [{ author: { login: "greptile-apps" }, url: "u" }] },
      },
    ],
  },
  firstComments: {
    nodes: [{ id: "C1", author: { login: "greptile-apps" }, body: "x", updatedAt: "1" }],
  },
  lastComments: {
    nodes: [
      { id: "C1", author: { login: "greptile-apps" }, body: "x", updatedAt: "1" },
      { id: "C2", author: null, body: "y", updatedAt: "2" },
    ],
  },
  commits: {
    nodes: [
      {
        commit: {
          oid: "abcdef1234567890abcdef1234567890abcdef12",
          statusCheckRollup: {
            state: "FAILURE",
            contexts: {
              nodes: [
                {
                  __typename: "CheckRun",
                  name: "build",
                  status: "COMPLETED",
                  conclusion: "FAILURE",
                  detailsUrl: "d",
                  isRequired: true,
                  checkSuite: { app: { slug: "github-actions" } },
                },
                {
                  __typename: "CheckRun",
                  name: "lint",
                  status: "IN_PROGRESS",
                  conclusion: null,
                  detailsUrl: null,
                  isRequired: false,
                  checkSuite: { app: { slug: "github-actions" } },
                },
                {
                  __typename: "StatusContext",
                  context: "legacy/ci",
                  state: "PENDING",
                  targetUrl: "t",
                  isRequired: false,
                },
              ],
            },
          },
        },
      },
    ],
  },
};

describe("normalizePullRequest", () => {
  const snapshot = normalizePullRequest("acme/widgets", RAW);

  test("lowercases shas and reads the base tip", () => {
    expect(snapshot.headSha).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(snapshot.baseSha).toBe("b".repeat(40));
    expect(snapshot.approvals[0]?.sha).toBe(snapshot.headSha);
  });

  test("maps check runs and status contexts", () => {
    const checks = snapshot.checks.map((check) => [
      check.name,
      check.kind,
      check.outcome,
      check.isRequired,
    ]);
    expect(checks).toEqual([
      ["build", "check", "fail", true],
      ["lint", "check", "pending", false],
      ["legacy/ci", "status", "pending", false],
    ]);
  });

  test("dedupes comments across the first and last windows", () => {
    expect(snapshot.comments.map((comment) => comment.id)).toEqual(["C1", "C2"]);
  });

  test("keeps mergeability, labels and threads", () => {
    expect(snapshot.mergeable).toBe("CONFLICTING");
    expect(snapshot.labels).toEqual(["autopilot"]);
    expect(snapshot.threads).toEqual([
      {
        id: "T1",
        resolved: false,
        outdated: true,
        author: "greptile-apps",
        path: "a.ts",
        url: "u",
      },
    ]);
  });

  test("merged PRs normalise to MERGED and missing rollups to no checks", () => {
    const merged = normalizePullRequest("acme/widgets", {
      ...RAW,
      state: "MERGED",
      commits: { nodes: [{ commit: { oid: "x", statusCheckRollup: null } }] },
    });
    expect(merged.state).toBe("MERGED");
    expect(merged.checks).toEqual([]);
  });
});

test.each([
  ["COMPLETED", "SUCCESS", "pass"],
  ["COMPLETED", "NEUTRAL", "pass"],
  ["COMPLETED", "SKIPPED", "pass"],
  ["COMPLETED", "FAILURE", "fail"],
  ["COMPLETED", "CANCELLED", "fail"],
  ["COMPLETED", "TIMED_OUT", "fail"],
  ["COMPLETED", "ACTION_REQUIRED", "fail"],
  ["IN_PROGRESS", null, "pending"],
  ["QUEUED", null, "pending"],
] as const)("check run %s/%s is %s", (status, conclusion, expected) => {
  expect(checkRunOutcome(status, conclusion)).toBe(expected);
});

test.each([
  ["SUCCESS", "pass"],
  ["PENDING", "pending"],
  ["EXPECTED", "pending"],
  ["FAILURE", "fail"],
  ["ERROR", "fail"],
] as const)("status %s is %s", (state, expected) => {
  expect(statusOutcome(state)).toBe(expected);
});
