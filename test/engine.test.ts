import { describe, expect, test } from "bun:test";
import { check, HEAD, HEAD2, REPO, snapshot } from "./fixtures/build.ts";
import { FakeClock } from "./fixtures/clock.ts";
import { ImmediateClock } from "./fixtures/immediate-clock.ts";
import { harness, pullRequestPayload, repository } from "./fixtures/harness.ts";
import type { Snapshot, TransitionKind } from "../src/core/types.ts";

const review = (id: string, number = 7) => ({
  id,
  event: "pull_request_review",
  payload: { action: "submitted", pull_request: pullRequestPayload(number), repository },
});

describe("delivery dedupe", () => {
  test.each([
    ["one delivery", ["d1"], 1],
    ["same delivery redelivered", ["d1", "d1"], 1],
    ["three distinct deliveries", ["d1", "d2", "d3"], 3],
    ["interleaved redeliveries", ["d1", "d2", "d1", "d2", "d3"], 3],
  ] as const)("%s", async (_l, ids, recomputes) => {
    const h = await harness();
    h.github.set(snapshot());
    h.engine.track(REPO, 7);
    await h.engine.idle();
    const before = h.github.readsOf(REPO, 7);
    const accepted: boolean[] = [];
    for (const id of ids) {
      accepted.push((await h.engine.handleDelivery(review(id))).accepted);
      await h.engine.idle();
    }
    expect(h.github.readsOf(REPO, 7) - before).toBe(recomputes);
    expect(accepted.filter(Boolean).length).toBe(recomputes);
  });
});

describe("mergeability UNKNOWN backoff", () => {
  const unknown = () => snapshot({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" });
  test.each([
    ["resolved on first read", 0, [], false],
    ["resolved after one retry", 1, [1000], false],
    ["resolved after three retries", 3, [1000, 2000, 4000], false],
    ["resolved on the last retry", 6, [1000, 2000, 4000, 8000, 16000, 30000], false],
    ["never resolves", 9, [1000, 2000, 4000, 8000, 16000, 30000], true],
  ] as const)("%s", async (_l, unknownReads, sleeps, exhausted) => {
    const clock = new ImmediateClock();
    const h = await harness({ clock });
    const seq: Snapshot[] = [...Array(unknownReads)].map(unknown);
    seq.push(
      unknownReads > 6
        ? unknown()
        : snapshot({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
    );
    h.github.script(...seq);
    h.engine.track(REPO, 7);
    await h.engine.idle();
    expect(clock.sleeps).toEqual([...sleeps]);
    expect(h.github.readsOf(REPO, 7)).toBe(sleeps.length + 1);
    expect(h.kinds().includes("mergeability_unknown")).toBe(exhausted);
    expect(h.kinds().includes("conflicted")).toBe(!exhausted);
  });

  test("closed PRs never back off", async () => {
    const clock = new ImmediateClock();
    const h = await harness({ clock });
    h.github.set(snapshot({ state: "MERGED", mergeable: "UNKNOWN" }));
    h.engine.track(REPO, 7);
    await h.engine.idle();
    expect(clock.sleeps).toEqual([]);
  });

  test("nothing sleeps or reads until an event arrives", async () => {
    const clock = new FakeClock();
    const h = await harness({ clock });
    h.github.set(unknown());
    await clock.advance(120_000);
    expect(clock.sleeps).toEqual([]);
    expect(h.github.readsOf(REPO, 7)).toBe(0);
  });

  test("backoff waits on the injected clock between reads", async () => {
    const clock = new FakeClock();
    const h = await harness({ clock });
    h.github.script(unknown(), unknown(), snapshot());
    h.engine.track(REPO, 7);
    await clock.advance(0);
    expect(h.github.readsOf(REPO, 7)).toBe(1);
    await clock.advance(999);
    expect(h.github.readsOf(REPO, 7)).toBe(1);
    await clock.advance(1);
    expect(h.github.readsOf(REPO, 7)).toBe(2);
    await clock.advance(2000);
    expect(h.github.readsOf(REPO, 7)).toBe(3);
    await h.engine.idle();
    expect(h.kinds()).toContain("ready");
  });
});

describe("resync heals missed events", () => {
  test.each<[string, Partial<Snapshot>, TransitionKind[]]>([
    [
      "missed conflict",
      { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" },
      ["conflicted", "not_ready"],
    ],
    ["missed merge", { state: "MERGED" }, ["merged"]],
    [
      "missed check failure",
      { checks: [check("build", "fail"), check("gate", "pass")] },
      ["checks_failed", "not_ready"],
    ],
    [
      "missed push",
      { headSha: HEAD2, approvals: [{ login: "reviewer", state: "APPROVED", sha: HEAD }] },
      [
        "head_moved",
        "checks_passed",
        "review_scored",
        "approval_stale",
        "awaiting_human",
        "not_ready",
      ],
    ],
  ])("%s", async (...row) => {
    const [, change, expected] = row;
    const h = await harness();
    h.github.set(snapshot());
    h.engine.track(REPO, 7);
    await h.engine.idle();
    const seen = h.kinds().length;
    h.github.set(snapshot(change));
    await h.engine.idle();
    expect(h.kinds().length).toBe(seen);
    await h.engine.resync("wake");
    await h.engine.idle();
    expect(h.kinds().slice(seen)).toEqual(expected);
  });

  test("resync auto-tracks open PRs matching the filter", async () => {
    const h = await harness();
    h.github.set(snapshot({ number: 12 }));
    h.github.searchResults = [
      {
        repo: REPO,
        number: 12,
        author: "octo",
        headRef: "bot/x",
        baseRef: "main",
        labels: [],
        open: true,
      },
      {
        repo: REPO,
        number: 13,
        author: "someone",
        headRef: "bot/y",
        baseRef: "main",
        labels: [],
        open: true,
      },
    ];
    await h.engine.resync("start");
    await h.engine.idle();
    expect(h.engine.status().map((p) => p.number)).toEqual([12]);
    expect(h.github.searches).toEqual([{ repo: REPO, author: "octo" }]);
  });
});

describe("routing through the engine", () => {
  test("push to the base branch rechecks every PR on that base", async () => {
    const h = await harness();
    h.github.set(snapshot({ number: 7 }));
    h.github.set(snapshot({ number: 8, headRef: "bot/other" }));
    h.github.set(snapshot({ number: 9, headRef: "bot/rel", baseRef: "release" }));
    for (const n of [7, 8, 9]) h.engine.track(REPO, n);
    await h.engine.idle();
    const r = await h.engine.handleDelivery({
      id: "p1",
      event: "push",
      payload: { ref: "refs/heads/main", repository },
    });
    await h.engine.idle();
    expect(r.scheduled.sort()).toEqual(["acme/widgets#7", "acme/widgets#8"]);
    expect([7, 8, 9].map((n) => h.github.readsOf(REPO, n))).toEqual([2, 2, 1]);
  });

  test("pull_request opened auto-tracks a matching PR", async () => {
    const h = await harness();
    h.github.set(snapshot());
    await h.engine.handleDelivery({
      id: "o1",
      event: "pull_request",
      payload: { action: "opened", pull_request: pullRequestPayload(7), repository },
    });
    await h.engine.idle();
    expect(h.store.getPullRequest("acme/widgets#7")).toMatchObject({
      tracked: true,
      source: "filter",
    });
    expect(h.kinds()).toContain("ready");
  });

  test("an untracked PR is not re-tracked by the filter", async () => {
    const h = await harness();
    h.github.set(snapshot());
    h.engine.track(REPO, 7);
    await h.engine.idle();
    h.engine.untrack(REPO, 7);
    await h.engine.handleDelivery({
      id: "s1",
      event: "pull_request",
      payload: { action: "synchronize", pull_request: pullRequestPayload(7), repository },
    });
    await h.engine.idle();
    expect(h.engine.status()).toEqual([]);
  });

  test("non-matching PRs and unknown repos are ignored", async () => {
    const h = await harness();
    await h.engine.handleDelivery({
      id: "o1",
      event: "pull_request",
      payload: {
        action: "opened",
        pull_request: pullRequestPayload(7, { user: { login: "someone" } }),
        repository,
      },
    });
    await h.engine.handleDelivery({
      id: "o2",
      event: "pull_request",
      payload: {
        action: "opened",
        pull_request: pullRequestPayload(7),
        repository: { full_name: "other/repo" },
      },
    });
    await h.engine.idle();
    expect(h.engine.status()).toEqual([]);
  });

  test("bursts coalesce into one read after the debounce window", async () => {
    const clock = new FakeClock();
    const h = await harness({ clock, config: { daemon: { debounceMs: 500 } } });
    h.github.set(snapshot());
    h.engine.track(REPO, 7);
    await clock.advance(500);
    expect(h.github.readsOf(REPO, 7)).toBe(1);
    for (const id of ["a", "b", "c", "d", "e"]) await h.engine.handleDelivery(review(id));
    await clock.advance(499);
    expect(h.github.readsOf(REPO, 7)).toBe(1);
    await clock.advance(1);
    await h.engine.idle();
    expect(h.github.readsOf(REPO, 7)).toBe(2);
  });

  test("an event during a recompute triggers exactly one more", async () => {
    const clock = new FakeClock();
    const h = await harness({ clock });
    h.github.script(snapshot({ mergeable: "UNKNOWN" }), snapshot());
    h.engine.track(REPO, 7);
    await clock.advance(0);
    await h.engine.handleDelivery(review("mid1"));
    await h.engine.handleDelivery(review("mid2"));
    await clock.advance(1000);
    await h.engine.idle();
    expect(h.github.readsOf(REPO, 7)).toBe(3);
  });

  test("merged PRs stop being tracked", async () => {
    const h = await harness();
    h.github.set(snapshot({ state: "MERGED" }));
    h.engine.track(REPO, 7);
    await h.engine.idle();
    expect(h.engine.status()).toEqual([]);
    await h.engine.handleDelivery(review("late"));
    await h.engine.idle();
    expect(h.github.readsOf(REPO, 7)).toBe(1);
  });
});

describe("auto-merge", () => {
  const cfg = { autoMerge: { labels: ["automerge"], method: "rebase" } };

  test.each<[string, Partial<Snapshot>, boolean | null, number]>([
    ["label opts in when mergeable now", { labels: ["automerge"] }, null, 1],
    ["no label waits for a human", {}, null, 0],
    ["per-PR flag opts in", {}, true, 1],
    ["per-PR flag opts out despite the label", { labels: ["automerge"] }, false, 0],
    [
      "ready but gate pending does not merge",
      {
        labels: ["automerge"],
        mergeStateStatus: "BLOCKED",
        checks: [check("build", "pass"), check("gate", "fail", { conclusion: "ACTION_REQUIRED" })],
      },
      null,
      0,
    ],
  ])("%s", async (...row) => {
    const [, o, flag, merges] = row;
    const h = await harness({ config: cfg });
    h.github.set(snapshot(o));
    h.engine.track(REPO, 7, { autoMerge: flag });
    await h.engine.idle();
    await h.engine.handleDelivery(review("again"));
    await h.engine.idle();
    expect(h.github.merges.length).toBe(merges);
    if (merges) {
      expect(h.github.merges[0]).toEqual({ repo: REPO, number: 7, sha: HEAD, method: "rebase" });
    }
    expect(h.kinds().filter((k) => k === "merge_attempted").length).toBe(merges);
  });

  test("failed merge is reported once per head", async () => {
    const h = await harness({ config: cfg });
    h.github.mergeError = "Base branch was modified";
    h.github.set(snapshot({ labels: ["automerge"] }));
    h.engine.track(REPO, 7);
    await h.engine.idle();
    const t = h.sink.lines.find((l) => l.kind === "merge_attempted")!;
    expect(t.data).toMatchObject({ ok: false, error: "Base branch was modified" });
  });

  test("custom merge command runs with PR env", async () => {
    const h = await harness({ config: { autoMerge: { default: true, command: "my-merge" } } });
    h.github.set(snapshot());
    h.engine.track(REPO, 7);
    await h.engine.idle();
    expect(
      h.runner.calls.map((c) => [
        c.command,
        c.env.PR_AUTOPILOT_NUMBER,
        c.env.PR_AUTOPILOT_MERGE_METHOD,
      ]),
    ).toEqual([["my-merge", "7", "squash"]]);
    expect(h.github.merges).toEqual([]);
  });
});

describe("notifications and bookkeeping", () => {
  test("notify targets run for their kinds with transition env and JSON stdin", async () => {
    const h = await harness({
      config: { notify: [{ type: "command", command: "notify-me", on: ["ready"] }] },
    });
    h.github.set(snapshot());
    h.engine.track(REPO, 7);
    await h.engine.idle();
    expect(h.runner.calls).toHaveLength(1);
    const c = h.runner.calls[0]!;
    expect(c.env).toMatchObject({
      PR_AUTOPILOT_KIND: "ready",
      PR_AUTOPILOT_REPO: REPO,
      PR_AUTOPILOT_NUMBER: "7",
    });
    expect(JSON.parse(c.stdin!).kind).toBe("ready");
  });

  test("base comparison is fetched once per head and base pair", async () => {
    const h = await harness({
      config: { readiness: { baseFreshness: { policy: "contains-tip" } } },
    });
    h.github.set(snapshot());
    h.github.comparisons.set(`${HEAD}..${"b".repeat(40)}`, {
      behindBy: 2,
      files: [],
      truncated: false,
    });
    h.engine.track(REPO, 7);
    await h.engine.idle();
    await h.engine.handleDelivery(review("x"));
    await h.engine.idle();
    expect(h.github.compareCalls).toBe(1);
    expect(h.kinds()).toContain("stale_base");
  });

  test("review request is recorded against the current head", async () => {
    const h = await harness();
    h.github.set(snapshot());
    h.engine.track(REPO, 7, { sessionId: "s1" });
    await h.engine.idle();
    expect(h.engine.markReviewRequested(REPO, 7)).toBe(HEAD);
    expect(h.store.getPullRequest("acme/widgets#7")).toMatchObject({
      reviewRequestedHead: HEAD,
      sessionId: "s1",
    });
  });

  test("tracking a repo outside the config is refused", async () => {
    const h = await harness();
    expect(() => h.engine.track("other/repo", 1)).toThrow(/not in any loaded/);
  });

  test("log lines carry id, timestamp, title and url", async () => {
    const h = await harness();
    h.github.set(snapshot());
    h.engine.track(REPO, 7);
    await h.engine.idle();
    const ids = h.sink.lines.map((l) => l.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(h.sink.lines[0]).toMatchObject({
      title: "Tidy the widget loader",
      url: `https://github.com/${REPO}/pull/7`,
      ts: "1970-01-01T00:00:00.000Z",
    });
  });
});
