import { describe, expect, test } from "bun:test";
import { formatClockTime } from "../src/core/duration.ts";
import { isPullRequestSummary } from "../src/core/guards.ts";
import { formatSummaries, type PullRequestSummary } from "../src/core/summary.ts";
import { controlHandler, type Health } from "../src/daemon/control.ts";
import { RateLimitError } from "../src/github/rate-limit.ts";
import { REPO, snapshot } from "./fixtures/build.ts";
import { FakeClock } from "./fixtures/clock.ts";
import { createHarness } from "./fixtures/harness.ts";

const MINUTE = 60_000;
const UNTIL = Date.UTC(2026, 9, 15, 14, 32);

const health = (): Health => ({
  ok: true,
  pid: 1,
  startedAt: "t",
  version: "v",
  repos: [REPO],
  source: { name: "replay", state: "connected", detail: "" },
});

const summary: PullRequestSummary = {
  pr: `${REPO}#7`,
  repo: REPO,
  number: 7,
  title: "Tidy",
  url: "u",
  head: null,
  state: "not_ready",
  ready: false,
  mergeableNow: false,
  awaitingHuman: false,
  reasons: [],
  autoMerge: null,
  sessionId: null,
  reviewRequestedHead: null,
  updatedAt: 0,
  blockedSince: null,
  nudges: 0,
  nextNudgeAt: null,
  hold: null,
  stale: { kind: "rate_limited", since: 0, ageMs: 12 * MINUTE },
  failure: { kind: "rate_limited", message: "GraphQL: API rate limit", at: 9 * MINUTE },
};

describe("status shows staleness and the GitHub pause", () => {
  test("a stale PR shows how long and the last error", () => {
    const lines = formatSummaries([summary], "daemon: running", 12 * MINUTE).split("\n");
    expect(lines).toContain("  stale:rate_limited 12m");
    expect(lines).toContain("  last error 3m ago: GraphQL: API rate limit");
  });

  test("the header says until when GitHub calls are paused", () => {
    const pause = { until: UNTIL, reason: "rate limited" };
    const lines = formatSummaries([], "daemon: running", 0, pause).split("\n");
    expect(lines.slice(0, 2)).toEqual([
      "daemon: running",
      `GitHub paused until ${formatClockTime(UNTIL)} (rate limited)`,
    ]);
    expect(formatClockTime(UNTIL)).toMatch(/^\d\d:\d\d$/u);
  });

  test("the control api reports the pause and each PR's staleness", async () => {
    const clock = new FakeClock();
    const harness = await createHarness({ clock });
    harness.github.set(snapshot());
    harness.github.paused = { until: UNTIL, reason: "rate limited" };
    harness.github.failures.push(new RateLimitError("rate limited", UNTIL));
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    const response = await controlHandler(
      harness.engine,
      health,
    )(new Request("http://localhost/status"));
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      github: { until: UNTIL, reason: "rate limited" },
      prs: [{ pr: `${REPO}#7`, stale: { kind: "rate_limited" } }],
    });
  });

  test("summaries from a daemon that predates staleness still parse", () => {
    const { stale, failure, ...older } = summary;
    expect([stale, failure].length).toBe(2);
    expect(isPullRequestSummary(older)).toBe(true);
    expect(isPullRequestSummary(summary)).toBe(true);
  });
});
