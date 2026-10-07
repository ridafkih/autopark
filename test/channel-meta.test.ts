import { describe, expect, test } from "bun:test";
import { channelContent, channelMeta, monitorLine } from "../src/channel/meta.ts";
import type { TransitionKind } from "../src/core/types.ts";
import { BASE_TRANSITION, TRANSITION_HEAD, transitionOf } from "./fixtures/transition.ts";

const META_KEY = /^[A-Za-z0-9_]+$/u;

describe("channel meta", () => {
  test.each<[TransitionKind, Record<string, unknown>, Record<string, string>]>([
    [
      "checks_failed",
      { names: ["build", "lint"], required: ["build"] },
      { failed: "build,lint", required_failed: "build" },
    ],
    [
      "review_scored",
      {
        bot: "greptile",
        score: 3,
        maxScore: 5,
        minScore: 4,
        head: "abc",
        onHead: true,
        meetsThreshold: false,
      },
      {
        bot: "greptile",
        score: "3",
        max_score: "5",
        min_score: "4",
        reviewed_head: "abc",
        on_head: "true",
        meets_threshold: "false",
      },
    ],
    ["threads_open", { count: 2, previous: 0 }, { count: "2" }],
    [
      "stale_base",
      { base: "main", baseSha: "bbb", behindBy: 4, touched: ["a.ts"], policy: "contains-tip" },
      { base: "main", base_sha: "bbb", behind_by: "4", touched: "a.ts", policy: "contains-tip" },
    ],
    ["head_moved", { from: "a", to: "b" }, { from: "a", to: "b" }],
    ["approved_on_head", { by: ["r1", "r2"] }, { by: "r1,r2" }],
    [
      "not_ready",
      {
        reasons: [
          { code: "conflict", detail: "x" },
          { code: "threads_open", detail: "y" },
        ],
      },
      { reasons: "conflict,threads_open" },
    ],
    [
      "merge_attempted",
      { method: "squash", ok: false, error: "nope" },
      { method: "squash", ok: "false", error: "nope" },
    ],
    ["ready", { mergeableNow: true }, { mergeable_now: "true" }],
  ])("%s", (kind, data, extra) => {
    const meta = channelMeta(transitionOf(kind, data));
    expect(meta).toMatchObject({
      kind,
      repo: "acme/widgets",
      pr: "7",
      head: TRANSITION_HEAD,
      transition_id: "42",
      url: BASE_TRANSITION.url,
      ...extra,
    });
    for (const [key, value] of Object.entries(meta)) {
      expect(key).toMatch(META_KEY);
      expect(typeof value).toBe("string");
    }
  });

  test("content is a factual one-liner with the PR link", () => {
    expect(channelContent(transitionOf("conflicted", {}, "conflicts with main"))).toBe(
      "acme/widgets#7 conflicted: conflicts with main (Tidy the widget loader) https://github.com/acme/widgets/pull/7",
    );
  });

  test("monitor line carries kind, pr, short head and reason on one line", () => {
    const reason = "required failed: build (FAILURE)\nsecond line";
    expect(monitorLine(transitionOf("checks_failed", {}, reason))).toBe(
      "pr-autopilot acme/widgets#7 checks_failed head=1111111: required failed: build (FAILURE) second line https://github.com/acme/widgets/pull/7",
    );
  });
});
