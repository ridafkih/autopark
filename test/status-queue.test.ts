import { describe, expect, test } from "bun:test";
import { formatCheckReport } from "../src/cli/commands/check-report.ts";
import { evaluate } from "../src/core/evaluate.ts";
import { isPullRequestSummary } from "../src/core/guards.ts";
import { formatSummaries, summarize } from "../src/core/summary.ts";
import type { Snapshot } from "../src/core/types.ts";
import type { PullRequestRecord } from "../src/daemon/store.ts";
import { greptile } from "../src/reviewers/greptile.ts";
import { config, REPO, snapshot } from "./fixtures/build.ts";

const parsers = new Map([["greptile", greptile]]);
const QUEUED = { state: "AWAITING_CHECKS", position: 6, enqueuedAt: "2026-11-04T21:45:11Z" };

const evaluated = (changes: Partial<Snapshot>) =>
  evaluate(snapshot(changes), config(), parsers, null);

const record = (changes: Partial<Snapshot>): PullRequestRecord => ({
  key: `${REPO}#7`.toLowerCase(),
  repo: REPO,
  number: 7,
  tracked: true,
  source: "explicit",
  sessionId: null,
  autoMerge: null,
  reviewRequestedHead: null,
  reviewRequestedReady: null,
  mergeAttemptHead: null,
  evaluation: evaluated(changes),
  nudge: null,
  updatedAt: 0,
  eventAt: null,
  evaluatedAt: null,
  staleSince: null,
  failure: null,
});

describe("queue state is shown", () => {
  test("status labels a queued PR with its position", () => {
    const summary = summarize(record({ mergeQueue: QUEUED }), { now: 0, holds: [] });
    expect(summary.state).toBe("queued");
    expect(summary.mergeQueue).toEqual({ state: "AWAITING_CHECKS", position: 6 });
    expect(isPullRequestSummary(summary)).toBe(true);
    const [heading] = formatSummaries([summary]).split("\n");
    expect(heading).toBe(
      `${REPO}#7 [queued] (queue position 6, AWAITING_CHECKS) Tidy the widget loader`,
    );
  });

  test("check reports the queue entry", () => {
    const report = formatCheckReport(evaluated({ mergeQueue: QUEUED }), { cost: 1, reads: 1 });
    expect(report.split("\n")).toContain(
      "merge queue: position 6, AWAITING_CHECKS, enqueued 2026-11-04T21:45:11Z",
    );
    expect(report).toContain("mergeable now false");
  });

  test("check reports when a PR is not queued", () => {
    const report = formatCheckReport(evaluated({}), { cost: 1, reads: 1 });
    expect(report.split("\n")).toContain("merge queue: not queued");
  });
});
