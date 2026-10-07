import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../src/core/types.ts";
import { BASE, check, HEAD, REPO, snapshot } from "./fixtures/build.ts";
import { createHarness } from "./fixtures/harness.ts";
import { reviewDelivery } from "./fixtures/review-delivery.ts";
import { parseJson, stringAt } from "../src/core/json.ts";

const AUTO_MERGE_CONFIG = { autoMerge: { labels: ["automerge"], method: "rebase" } };

describe("auto-merge", () => {
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
  ])("%s", async (label, overrides, autoMergeOverride, merges) => {
    const harness = await createHarness({ config: AUTO_MERGE_CONFIG });
    harness.github.set(snapshot(overrides));
    harness.engine.track(REPO, 7, { autoMerge: autoMergeOverride });
    await harness.engine.idle();
    await harness.engine.handleDelivery(reviewDelivery("again"));
    await harness.engine.idle();
    expect(harness.github.merges.length).toBe(merges);
    if (merges > 0) {
      const expected = { repo: REPO, number: 7, sha: HEAD, method: "rebase" };
      expect(harness.github.merges[0]).toEqual(expected);
    }
    const attempts = harness.kinds().filter((kind) => kind === "merge_attempted");
    expect(attempts.length).toBe(merges);
  });

  test("failed merge is reported once per head", async () => {
    const harness = await createHarness({ config: AUTO_MERGE_CONFIG });
    harness.github.mergeError = "Base branch was modified";
    harness.github.set(snapshot({ labels: ["automerge"] }));
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    const attempt = harness.sink.lines.find((line) => line.kind === "merge_attempted");
    expect(attempt?.data).toMatchObject({ ok: false, error: "Base branch was modified" });
  });

  test("custom merge command runs with PR env", async () => {
    const harness = await createHarness({
      config: { autoMerge: { default: true, command: "my-merge" } },
    });
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    const calls = harness.runner.calls.map((call) => [
      call.command,
      call.env.AUTOPARK_NUMBER,
      call.env.AUTOPARK_MERGE_METHOD,
    ]);
    expect(calls).toEqual([["my-merge", "7", "squash"]]);
    expect(harness.github.merges).toEqual([]);
  });
});

describe("notifications and bookkeeping", () => {
  test("notify targets run for their kinds with transition env and JSON stdin", async () => {
    const harness = await createHarness({
      config: { notify: [{ type: "command", command: "notify-me", on: ["ready"] }] },
    });
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    expect(harness.runner.calls).toHaveLength(1);
    const [call] = harness.runner.calls;
    expect(call?.env).toMatchObject({
      AUTOPARK_KIND: "ready",
      AUTOPARK_REPO: REPO,
      AUTOPARK_NUMBER: "7",
    });
    expect(stringAt(parseJson(call?.stdin ?? ""), "kind")).toBe("ready");
  });

  test("base comparison is fetched once per head and base pair", async () => {
    const harness = await createHarness({
      config: { readiness: { baseFreshness: { policy: "contains-tip" } } },
    });
    harness.github.set(snapshot());
    harness.github.comparisons.set(`${HEAD}..${BASE}`, {
      behindBy: 2,
      files: [],
      truncated: false,
    });
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    await harness.engine.handleDelivery(reviewDelivery("x"));
    await harness.engine.idle();
    expect(harness.github.compareCalls).toBe(1);
    expect(harness.kinds()).toContain("stale_base");
  });

  test("review request is recorded against the current head", async () => {
    const harness = await createHarness();
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7, { sessionId: "s1" });
    await harness.engine.idle();
    expect(harness.engine.markReviewRequested(REPO, 7)).toBe(HEAD);
    expect(harness.store.getPullRequest("acme/widgets#7")).toMatchObject({
      reviewRequestedHead: HEAD,
      sessionId: "s1",
    });
  });

  test("tracking a repo outside the config is refused", async () => {
    const harness = await createHarness();
    expect(() => harness.engine.track("other/repo", 1)).toThrow(/not in any loaded/u);
  });

  test("log lines carry id, timestamp, title and url", async () => {
    const harness = await createHarness();
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    const ids = harness.sink.lines.map((line) => line.id);
    expect(ids).toEqual(ids.toSorted((left, right) => left - right));
    expect(harness.sink.lines[0]).toMatchObject({
      title: "Tidy the widget loader",
      url: `https://github.com/${REPO}/pull/7`,
      ts: "1970-01-01T00:00:00.000Z",
    });
  });
});
