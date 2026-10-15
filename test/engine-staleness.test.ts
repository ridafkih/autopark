import { describe, expect, test } from "bun:test";
import { pullRequestKey } from "../src/core/types.ts";
import { RateLimitError } from "../src/github/rate-limit.ts";
import { REPO, snapshot } from "./fixtures/build.ts";
import { FakeClock } from "./fixtures/clock.ts";
import { createHarness, pullRequestPayload, repository } from "./fixtures/harness.ts";
import { reviewDelivery } from "./fixtures/review-delivery.ts";

const KEY = pullRequestKey(REPO, 7);
const PAUSE_MS = 10 * 60_000;

async function trackedHarness() {
  const clock = new FakeClock();
  const harness = await createHarness({ clock });
  harness.github.set(snapshot());
  harness.engine.track(REPO, 7);
  await harness.engine.idle();
  await clock.advance(1000);
  const summary = () => harness.engine.nudges.summaries(harness.engine.status())[0];
  return { ...harness, clock, summary };
}

const lifecycleDelivery = (id: string, action: string, extra: Record<string, unknown>) => ({
  id,
  event: "pull_request",
  payload: { action, pull_request: pullRequestPayload(7, extra), repository },
});

type Harness = Awaited<ReturnType<typeof trackedHarness>>;

async function scheduledBy(
  engine: Harness["engine"],
  delivery: Parameters<Harness["engine"]["handleDelivery"]>[0],
) {
  const result = await engine.handleDelivery(delivery);
  return result.scheduled;
}

const checkRunDelivery = (id: string) => ({
  id,
  event: "check_run",
  payload: {
    action: "completed",
    check_run: { head_sha: snapshot().headSha, pull_requests: [{ number: 7 }] },
    repository,
  },
});

describe("recompute failures are recorded as staleness", () => {
  test("a rate-limited recompute marks the PR stale until the pause ends", async () => {
    const { engine, github, clock, store, summary } = await trackedHarness();
    expect(summary()?.stale).toBeNull();
    github.failures.push(new RateLimitError("GraphQL: API rate limit", clock.now() + PAUSE_MS));
    await engine.handleDelivery(reviewDelivery("d1"));
    await engine.idle();
    await clock.advance(60_000);
    expect(store.getPullRequest(KEY)?.failure?.kind).toBe("rate_limited");
    expect(summary()?.stale).toMatchObject({ kind: "rate_limited", since: 1000, ageMs: 60_000 });
    expect(summary()?.failure?.message).toContain("API rate limit");
    await clock.advance(PAUSE_MS);
    expect(summary()?.stale).toBeNull();
    expect(summary()?.failure).toBeNull();
  });

  test("other recompute errors mark the PR stale with an error", async () => {
    const { engine, github, clock, summary } = await trackedHarness();
    github.failures.push(new Error("ECONNRESET"));
    await engine.handleDelivery(reviewDelivery("d1"));
    await engine.idle();
    expect(summary()?.stale?.kind).toBe("error");
    await clock.advance(60_000);
    expect(summary()?.stale).toBeNull();
  });
});

describe("closed and merged PRs stop recomputing", () => {
  test("a merged event finishes the PR without asking GitHub again", async () => {
    const { engine, github, store, kinds } = await trackedHarness();
    const reads = github.readsOf(REPO, 7);
    const merged = lifecycleDelivery("d1", "closed", { state: "closed", merged: true });
    expect(await scheduledBy(engine, merged)).toEqual([]);
    await engine.idle();
    expect(kinds()).toContain("merged");
    expect(store.getPullRequest(KEY)?.tracked).toBe(false);
    expect(await scheduledBy(engine, checkRunDelivery("d2"))).toEqual([]);
    await engine.idle();
    expect(github.readsOf(REPO, 7)).toBe(reads);
  });

  test("a reopened event resumes a PR closed without merging", async () => {
    const { engine, github, store, kinds } = await trackedHarness();
    await engine.handleDelivery(lifecycleDelivery("d1", "closed", { state: "closed" }));
    expect(kinds()).toContain("closed");
    const reopened = lifecycleDelivery("d2", "reopened", { state: "open" });
    expect(await scheduledBy(engine, reopened)).toEqual([KEY]);
    await engine.idle();
    expect(store.getPullRequest(KEY)?.tracked).toBe(true);
    expect(store.getPullRequest(KEY)?.evaluation?.state).toBe("OPEN");
    expect(github.readsOf(REPO, 7)).toBe(2);
  });

  test("an explicitly untracked open PR stays untracked when an event arrives", async () => {
    const { engine, store } = await trackedHarness();
    engine.untrack(REPO, 7);
    const reopened = lifecycleDelivery("d1", "reopened", { state: "open" });
    expect(await scheduledBy(engine, reopened)).toEqual([]);
    expect(store.getPullRequest(KEY)?.tracked).toBe(false);
  });
});

describe("rate-limited merges", () => {
  test("a merge refused by a rate limit is retried once the pause ends", async () => {
    const clock = new FakeClock();
    const harness = await createHarness({ clock, config: { autoMerge: { default: true } } });
    harness.github.set(snapshot());
    const merge = harness.github.merge.bind(harness.github);
    const refusals = [new RateLimitError("secondary rate limit", PAUSE_MS)];
    harness.github.merge = async (...args) => {
      const refusal = refusals.shift();
      if (refusal) throw refusal;
      await merge(...args);
    };
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    expect(harness.github.merges).toHaveLength(0);
    expect(harness.kinds()).not.toContain("merge_attempted");
    await clock.advance(PAUSE_MS);
    expect(harness.github.merges).toHaveLength(1);
    expect(harness.kinds().filter((kind) => kind === "merge_attempted")).toHaveLength(1);
  });
});
