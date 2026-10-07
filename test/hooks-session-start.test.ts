import { describe, expect, test } from "bun:test";
import { sessionStartContext } from "../src/hooks/session-start.ts";
import type { HookState } from "../src/hooks/state.ts";
import { config } from "./fixtures/build.ts";
import { hookState, PLAYBOOK, view } from "./fixtures/hook-state.ts";

describe("SessionStart context", () => {
  test("ready PR with a healthy daemon", () => {
    expect(sessionStartContext(hookState())).toBe(
      [
        "pr-autopilot daemon is running (pid 99, gh-webhook-forward connected).",
        "Tracked PRs:",
        "- acme/widgets#7 [ready] Tidy the widget loader",
        `React to pr-autopilot events using ${PLAYBOOK}.`,
      ].join("\n"),
    );
  });

  test("blocking reasons and actionable items are listed", () => {
    const context = sessionStartContext(hookState({ views: [view({ mergeable: "CONFLICTING" })] }));
    expect(context).toContain(
      "- acme/widgets#7 [not_ready] Tidy the widget loader\n  blocking: conflict: conflicts with main",
    );
    expect(context).toContain(
      "Actionable now:\n- acme/widgets#7 conflict: conflicts with main. Next: merge main into the branch, resolve, push.",
    );
  });

  test("a stopped daemon is called out with how to start it", () => {
    const [firstLine] = (sessionStartContext(hookState({ health: null })) ?? "").split("\n");
    expect(firstLine).toBe(
      "pr-autopilot daemon is not running, so PR events are not being watched. Start it with `pr-autopilot daemon start`.",
    );
  });

  test.each<[string, Partial<HookState>, boolean]>([
    [
      "unrelated session with no config stays quiet",
      { config: null, views: [view({}, "other")] },
      false,
    ],
    ["no config but this session tracks a PR", { config: null, views: [view({}, "s1")] }, true],
    ["config present with nothing tracked still orients the session", { views: [] }, true],
    [
      "disabled in config",
      { config: config({ hooks: { sessionStart: { enabled: false } } }) },
      false,
    ],
  ])("%s", (...row) => {
    const [, overrides, isPresent] = row;
    expect(sessionStartContext(hookState(overrides)) !== null).toBe(isPresent);
  });

  test("PRs from other repos tracked by other sessions are left out", () => {
    const other = { ...view({ repo: "acme/other", number: 9 }, "s2") };
    expect(sessionStartContext(hookState({ views: [view({}), other] }))).not.toContain(
      "acme/other#9",
    );
  });
});
