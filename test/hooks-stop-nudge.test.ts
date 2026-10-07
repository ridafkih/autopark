import { describe, expect, test } from "bun:test";
import type { NudgeState } from "../src/core/nudge.ts";
import { PAUSE_RULE } from "../src/core/nudge-message.ts";
import type { TrackedView } from "../src/core/stop.ts";
import { stringAt } from "../src/core/json.ts";
import { stopHook, type StopHookState } from "../src/hooks/stop.ts";
import { HEAD } from "./fixtures/build.ts";
import { hookState, view } from "./fixtures/hook-state.ts";

const MINUTE = 60_000;

const nudged = (overrides: Partial<NudgeState> = {}): NudgeState => ({
  signature: "approval_missing,awaiting_human",
  since: 0,
  headMovedAt: null,
  lastNudgeAt: 10 * MINUTE,
  count: 1,
  next: "re-request review: Ask Cortana",
  ...overrides,
});

const runStop = (views: TrackedView[], overrides: Partial<StopHookState> = {}) =>
  stopHook({
    ...hookState({ views, now: 20 * MINUTE }),
    stopHookActive: false,
    priorBlocks: 0,
    priorMark: 0,
    ...overrides,
  });

const reasonOf = (views: TrackedView[], overrides: Partial<StopHookState> = {}) =>
  stringAt(runStop(views, overrides).output, "reason");

describe("Stop hook and the pause rule", () => {
  test("the block reason states the rule, then each blocked PR and its reasons", () => {
    const reason = reasonOf([view({ mergeable: "CONFLICTING" })]);
    expect(reason).toStartWith(`${PAUSE_RULE}\nTracked PRs have actionable items:\n`);
    expect(reason).toContain("- acme/widgets#7 conflict: conflicts with main.");
  });

  test("a held PR does not block", () => {
    const held = {
      ...view({ mergeable: "CONFLICTING" }),
      hold: { until: 30 * MINUTE, reason: "design", scope: "pr" as const },
    };
    expect(runStop([held]).output).toBeNull();
  });

  test("awaiting_human blocks until review is requested on the head", () => {
    expect(reasonOf([view({ approvals: [] })])).toContain(
      "acme/widgets#7 review_not_requested: head 1111111 has no review request.",
    );
    const requested = { ...view({ approvals: [] }), reviewRequestedHead: HEAD };
    expect(runStop([requested]).output).toBeNull();
  });

  test("a nudged PR blocks even when review was already requested", () => {
    const stuck = { ...view({ approvals: [] }), reviewRequestedHead: HEAD, nudge: nudged() };
    const reason = reasonOf([stuck]);
    expect(reason).toContain(
      "- acme/widgets#7 nudged: stuck on approval_missing, awaiting_human, nudged 1x. Next: re-request review: Ask Cortana.",
    );
  });

  test("the block count resets when a new nudge has arrived since the last block", () => {
    const stuck = { ...view({ approvals: [] }), reviewRequestedHead: HEAD, nudge: nudged() };
    const capped = { stopHookActive: true, priorBlocks: 3, priorMark: 10 * MINUTE };
    expect(runStop([stuck], capped).output).toMatchObject({ systemMessage: expect.any(String) });
    const renewed = { ...stuck, nudge: nudged({ lastNudgeAt: 15 * MINUTE, count: 2 }) };
    const result = runStop([renewed], capped);
    expect(result).toMatchObject({ blocks: 1, mark: 15 * MINUTE });
    expect(stringAt(result.output, "decision")).toBe("block");
  });
});
