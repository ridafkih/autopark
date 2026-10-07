import { describe, expect, test } from "bun:test";
import type { NudgeState } from "../src/core/nudge.ts";
import { PAUSE_RULE } from "../src/core/nudge-message.ts";
import { sessionStartContext } from "../src/hooks/session-start.ts";
import { hookState, view } from "./fixtures/hook-state.ts";

const MINUTE = 60_000;
const openThread = {
  id: "t",
  resolved: false,
  outdated: false,
  author: null,
  path: null,
  url: null,
};

const stuckSince = (since: number, count = 0): NudgeState => ({
  signature: "threads_open",
  since,
  headMovedAt: null,
  lastNudgeAt: count > 0 ? since : null,
  count,
  next: null,
});

describe("SessionStart with stuck and held PRs", () => {
  test("the oldest stuck PR comes first, with how long it has been stuck", () => {
    const recent = {
      ...view({ number: 8, threads: [openThread] }),
      nudge: stuckSince(20 * MINUTE),
    };
    const oldest = {
      ...view({ number: 9, threads: [openThread] }),
      nudge: stuckSince(5 * MINUTE, 2),
    };
    const context = sessionStartContext(
      hookState({ views: [view({}), recent, oldest], now: 30 * MINUTE }),
    );
    const headings = (context ?? "").split("\n").filter((line) => / \[\w+\] /u.test(line));
    expect(headings.map((line) => line.split(" ")[1])).toEqual([
      "acme/widgets#9",
      "acme/widgets#8",
      "acme/widgets#7",
    ]);
    expect(context).toContain("  stuck 25m, nudged 2x");
    expect(context).toContain("  stuck 10m\n");
  });

  test("a held PR says until when and why", () => {
    const held = {
      ...view({ threads: [openThread] }),
      hold: { until: 50 * MINUTE, reason: "waiting on design", scope: "all" as const },
    };
    const context = sessionStartContext(hookState({ views: [held], now: 30 * MINUTE }));
    expect(context).toContain("  held 20m more (every PR): waiting on design");
  });

  test("the pause rule is part of every session's orientation", () => {
    expect(sessionStartContext(hookState())).toContain(PAUSE_RULE);
  });
});
