import { describe, expect, test } from "bun:test";
import { normalizePullRequest } from "../src/github/snapshot.ts";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

const RAW = {
  number: 7,
  title: "Tidy",
  url: "https://github.com/acme/widgets/pull/7",
  state: "OPEN",
  isDraft: false,
  headRefName: "bot/tidy",
  baseRefName: "main",
  headRefOid: HEAD,
  author: { login: "octo" },
};

const run = (name: string, conclusion: string | null, startedAt: string | null, url: string) => ({
  name,
  status: conclusion === null ? "IN_PROGRESS" : "COMPLETED",
  conclusion,
  detailsUrl: url,
  startedAt,
  isRequired: name === "Merge Ready",
});

const suite = (event: string, runs: Array<ReturnType<typeof run>>) => ({
  app: { slug: "github-actions" },
  workflowRun: { event, workflow: { name: "Pull Request" } },
  checkRuns: { nodes: runs },
});

const withHeadSuites = (
  rollup: Array<ReturnType<typeof run>>,
  suites: Array<ReturnType<typeof suite>>,
) =>
  normalizePullRequest("acme/widgets", {
    ...RAW,
    commits: {
      nodes: [
        {
          commit: {
            oid: HEAD,
            statusCheckRollup: {
              state: "SUCCESS",
              contexts: {
                nodes: rollup.map((check) => ({
                  __typename: "CheckRun",
                  ...check,
                  checkSuite: {
                    app: { slug: "github-actions" },
                    workflowRun: { workflow: { name: "Pull Request" } },
                  },
                })),
              },
            },
            checkSuites: { nodes: suites },
          },
        },
      ],
    },
  });

const outcomes = (snapshot: ReturnType<typeof normalizePullRequest>) =>
  snapshot.checks.map((check) => [check.name, check.outcome, check.isRequired, check.url]);

describe("head commit check suites outside the pull request rollup", () => {
  const pullRequestRun = [
    run("E2E CI", "SKIPPED", "2026-10-14T23:15:00Z", "pr/e2e"),
    run("Merge Ready", "SUCCESS", "2026-10-14T23:24:00Z", "pr/ready"),
  ];

  test("a dispatched run that fails after the pull request run passed blocks the check", () => {
    const snapshot = withHeadSuites(pullRequestRun, [
      suite("pull_request", pullRequestRun),
      suite("workflow_dispatch", [
        run("E2E CI", "FAILURE", "2026-10-14T23:34:00Z", "dispatch/e2e"),
        run("Merge Ready", "FAILURE", "2026-10-14T23:40:00Z", "dispatch/ready"),
      ]),
    ]);
    expect(outcomes(snapshot)).toEqual([
      ["E2E CI", "fail", false, "dispatch/e2e"],
      ["Merge Ready", "fail", true, "dispatch/ready"],
    ]);
  });

  test("a newer passing dispatched run clears an older failed one", () => {
    const snapshot = withHeadSuites(pullRequestRun, [
      suite("pull_request", pullRequestRun),
      suite("workflow_dispatch", [
        run("E2E CI", "FAILURE", "2026-10-14T23:34:00Z", "old/e2e"),
        run("Merge Ready", "FAILURE", "2026-10-14T23:40:00Z", "old/ready"),
      ]),
      suite("workflow_dispatch", [
        run("E2E CI", "SUCCESS", "2026-10-15T00:10:00Z", "new/e2e"),
        run("Merge Ready", "SUCCESS", "2026-10-15T00:16:00Z", "new/ready"),
      ]),
    ]);
    expect(outcomes(snapshot)).toEqual([
      ["E2E CI", "pass", false, "new/e2e"],
      ["Merge Ready", "pass", true, "new/ready"],
    ]);
  });

  test("a dispatched run still in progress keeps the check pending", () => {
    const snapshot = withHeadSuites(pullRequestRun, [
      suite("pull_request", pullRequestRun),
      suite("workflow_dispatch", [run("Merge Ready", null, null, "dispatch/ready")]),
    ]);
    expect(outcomes(snapshot)).toEqual([
      ["E2E CI", "pass", false, "pr/e2e"],
      ["Merge Ready", "pending", true, "dispatch/ready"],
    ]);
  });

  test("same-named checks from different workflows stay separate", () => {
    const other = {
      ...suite("pull_request", [run("lint", "FAILURE", "2026-10-14T23:00:00Z", "other/lint")]),
      workflowRun: { event: "pull_request", workflow: { name: "Docs" } },
    };
    const snapshot = withHeadSuites(
      [run("lint", "SUCCESS", "2026-10-14T23:05:00Z", "pr/lint")],
      [suite("pull_request", [run("lint", "SUCCESS", "2026-10-14T23:05:00Z", "pr/lint")]), other],
    );
    expect(outcomes(snapshot)).toEqual([
      ["lint", "pass", false, "pr/lint"],
      ["lint", "fail", false, "other/lint"],
    ]);
  });
});
