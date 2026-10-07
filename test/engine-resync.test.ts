import { describe, expect, test } from "bun:test";
import type { Snapshot, TransitionKind } from "../src/core/types.ts";
import { check, HEAD, HEAD2, REPO, snapshot } from "./fixtures/build.ts";
import { createHarness } from "./fixtures/harness.ts";

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
  ])("%s", async (label, change, expected) => {
    const harness = await createHarness();
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    const seen = harness.kinds().length;
    harness.github.set(snapshot(change));
    await harness.engine.idle();
    expect(harness.kinds().length).toBe(seen);
    await harness.engine.resync("wake");
    await harness.engine.idle();
    expect(harness.kinds().slice(seen)).toEqual(expected);
  });

  test("resync auto-tracks open PRs matching the filter", async () => {
    const harness = await createHarness();
    harness.github.set(snapshot({ number: 12 }));
    harness.github.searchResults = [
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
    await harness.engine.resync("start");
    await harness.engine.idle();
    expect(harness.engine.status().map((record) => record.number)).toEqual([12]);
    expect(harness.github.searches).toEqual([{ repo: REPO, author: "octo" }]);
  });
});
