import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatCheckReport } from "../src/cli/commands/check-report.ts";
import { evaluate } from "../src/core/evaluate.ts";
import { isPullRequestSummary } from "../src/core/guards.ts";
import { formatSummaries, type PullRequestSummary } from "../src/core/summary.ts";
import { Store } from "../src/daemon/store.ts";
import { greptile } from "../src/reviewers/greptile.ts";
import { config, HEAD, REPO, snapshot } from "./fixtures/build.ts";

const EARLY = "requested early (draft/not reviewable); will re-ask when reviewable";
const unapproved = { approvals: [], reviewDecision: "REVIEW_REQUIRED" };
const evaluation = evaluate(
  snapshot({ ...unapproved, isDraft: true }),
  config(),
  new Map([["greptile", greptile]]),
  null,
);
const cost = { cost: 1, reads: 1 };

const summary: PullRequestSummary = {
  pr: `${REPO}#7`,
  repo: REPO,
  number: 7,
  title: "Tidy",
  url: "u",
  head: HEAD,
  state: "not_ready",
  ready: false,
  mergeableNow: false,
  awaitingHuman: false,
  reasons: [{ code: "approval_missing", detail: "needs 1 approval(s) on head, has 0" }],
  autoMerge: null,
  sessionId: null,
  reviewRequestedHead: HEAD,
  reviewRequestedReady: false,
  reviewRequestWhen: "ready",
  updatedAt: 0,
  blockedSince: null,
  nudges: 0,
  nextNudgeAt: null,
  hold: null,
};

const statusLines = (changes: Partial<PullRequestSummary>) =>
  formatSummaries([{ ...summary, ...changes }], "daemon: running", 0).split("\n");

describe("status and check show the approval request", () => {
  test("status says a premature request will be re-asked", () => {
    expect(statusLines({})).toContain(`  approval requested at 1111111: ${EARLY}`);
  });

  test("status shows a request made while reviewable without the early note", () => {
    expect(statusLines({ reviewRequestedReady: true })).toContain(
      "  approval requested at 1111111",
    );
  });

  test("status shows a missing request", () => {
    expect(statusLines({ reviewRequestedHead: null })).toContain("  approval not requested");
  });

  test("open mode never claims a re-ask", () => {
    const lines = statusLines({ reviewRequestWhen: "open" });
    expect(lines).toContain("  approval requested at 1111111");
    expect(lines.join("\n")).not.toContain("re-ask");
  });

  test("summaries from a daemon without the new fields still parse", () => {
    const { reviewRequestedReady, reviewRequestWhen, ...legacy } = summary;
    expect([reviewRequestedReady, reviewRequestWhen]).toEqual([false, "ready"]);
    expect(isPullRequestSummary(legacy)).toBe(true);
    expect(isPullRequestSummary(summary)).toBe(true);
  });

  test("check reports the request and whether it was premature", () => {
    const request = { head: HEAD, ready: false, when: "ready" as const };
    const report = formatCheckReport(evaluation, cost, request);
    expect(report).toContain(`approval requested at 1111111: ${EARLY}`);
    const missing = formatCheckReport(evaluation, cost, { ...request, head: null });
    expect(missing).toContain("approval not requested");
  });
});

describe("review request readiness storage", () => {
  test("an existing database gains review_requested_ready and old rows read as unknown", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apl-")), "state.db");
    const legacy = new Database(path, { create: true });
    legacy.run(
      "CREATE TABLE prs (key TEXT PRIMARY KEY, repo TEXT NOT NULL, number INTEGER NOT NULL, tracked INTEGER NOT NULL, source TEXT NOT NULL, session_id TEXT, auto_merge INTEGER, review_requested_head TEXT, merge_attempt_head TEXT, evaluation TEXT, updated_at INTEGER NOT NULL)",
    );
    legacy.run(
      "INSERT INTO prs (key, repo, number, tracked, source, review_requested_head, updated_at) VALUES ('acme/widgets#7', 'acme/widgets', 7, 1, 'explicit', 'abc', 1)",
    );
    legacy.close();
    const store = new Store(path);
    expect(store.getPullRequest("acme/widgets#7")).toMatchObject({
      reviewRequestedHead: "abc",
      reviewRequestedReady: null,
    });
    store.setReviewRequested("acme/widgets#7", "def", true);
    expect(store.getPullRequest("acme/widgets#7")?.reviewRequestedReady).toBe(true);
    store.setReviewRequested("acme/widgets#7", "def", false);
    expect(store.getPullRequest("acme/widgets#7")?.reviewRequestedReady).toBe(false);
    store.close();
  });
});
