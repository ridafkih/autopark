import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/core/evaluate.ts";
import { sessionStartContext } from "../src/hooks/session-start.ts";
import { shipContext } from "../src/hooks/ship-context.ts";
import type { HookState } from "../src/hooks/state.ts";
import { stopHook } from "../src/hooks/stop.ts";
import { BUILTIN_PARSERS } from "../src/reviewers/index.ts";
import type { TrackedView } from "../src/core/stop.ts";
import type { Snapshot } from "../src/core/types.ts";
import { config, snap } from "./fixtures/build.ts";

const parsers = new Map([["greptile", BUILTIN_PARSERS.greptile!]]);
const cfg = config();
const health = {
  ok: true as const,
  pid: 99,
  startedAt: "t",
  version: "0.1.0",
  repos: ["acme/widgets"],
  source: { name: "gh-webhook-forward", state: "connected" as const, detail: "" },
};
const view = (o: Partial<Snapshot>, sessionId: string | null = "s1"): TrackedView => ({
  evaluation: evaluate(snap(o), cfg, parsers, null),
  sessionId,
  reviewRequestedHead: null,
});
const PLAYBOOK = "the pr-autopilot:pr-autopilot skill";

const state = (o: Partial<HookState> = {}): HookState => ({
  health,
  views: [view({})],
  config: cfg,
  sessionId: "s1",
  playbook: PLAYBOOK,
  ...o,
});

describe("SessionStart context", () => {
  test("ready PR with a healthy daemon", () => {
    expect(sessionStartContext(state())).toBe(
      [
        "pr-autopilot daemon is running (pid 99, gh-webhook-forward connected).",
        "Tracked PRs:",
        "- acme/widgets#7 [ready] Tidy the widget loader",
        `React to pr-autopilot events using ${PLAYBOOK}.`,
      ].join("\n"),
    );
  });

  test("blocking reasons and actionable items are listed", () => {
    const ctx = sessionStartContext(state({ views: [view({ mergeable: "CONFLICTING" })] }))!;
    expect(ctx).toContain(
      "- acme/widgets#7 [not_ready] Tidy the widget loader\n  blocking: conflict: conflicts with main",
    );
    expect(ctx).toContain(
      "Actionable now:\n- acme/widgets#7 conflict: conflicts with main. Next: merge main into the branch, resolve, push.",
    );
  });

  test("a stopped daemon is called out with how to start it", () => {
    expect(sessionStartContext(state({ health: null }))!.split("\n")[0]).toBe(
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
    const [, o, present] = row;
    expect(sessionStartContext(state(o)) !== null).toBe(present);
  });

  test("PRs from other repos tracked by other sessions are left out", () => {
    const other = { ...view({ repo: "acme/other", number: 9 } as Partial<Snapshot>, "s2") };
    expect(sessionStartContext(state({ views: [view({}), other] }))).not.toContain("acme/other#9");
  });
});

describe("Stop hook", () => {
  const conflicted = [view({ mergeable: "CONFLICTING" })];

  test.each<[string, Partial<HookState>, boolean, number, unknown, number]>([
    ["ready PR lets the turn end", {}, false, 0, null, 0],
    ["conflict blocks with the next step", { views: conflicted }, false, 0, "block", 1],
    ["continuing under the cap blocks again", { views: conflicted }, true, 1, "block", 2],
    ["cap reached lets go with a message", { views: conflicted }, true, 3, "message", 0],
    [
      "pending checks never block",
      { views: [view({ checks: [], approvals: [] })] },
      false,
      0,
      null,
      0,
    ],
    [
      "another session's conflict is out of scope",
      { views: [view({ mergeable: "CONFLICTING" }, "s2")] },
      false,
      0,
      null,
      0,
    ],
    [
      "daemon down warns instead of blocking on stale state",
      { views: conflicted, health: null },
      false,
      0,
      "message",
      0,
    ],
    [
      "disabled in config",
      { views: conflicted, config: config({ hooks: { stop: { enabled: false } } }) },
      false,
      0,
      null,
      0,
    ],
    [
      "no config uses session scope defaults",
      { views: conflicted, config: null },
      false,
      0,
      "block",
      1,
    ],
  ])("%s", (...row) => {
    const [, o, active, prior, expected, blocks] = row;
    const r = stopHook({ ...state(o), stopHookActive: active, priorBlocks: prior });
    expect(r.blocks).toBe(blocks);
    if (expected === null) expect(r.output).toBeNull();
    if (expected === "block") {
      expect(r.output).toMatchObject({ decision: "block" });
      expect((r.output as any).reason).toContain(
        "acme/widgets#7 conflict: conflicts with main. Next: merge main into the branch, resolve, push.",
      );
      expect((r.output as any).reason).toContain(PLAYBOOK);
    }
    if (expected === "message") expect(Object.keys(r.output as object)).toEqual(["systemMessage"]);
  });
});

describe("/ship context", () => {
  const exists = (f: string) => f.endsWith("CLAUDE.md");

  test("lists standards, skills, review request, auto-merge and daemon state", () => {
    const c = config({
      standards: {
        files: ["CLAUDE.md", "AGENTS.md"],
        skills: ["team-standards"],
        prBodyTemplate: ".github/pull_request_template.md",
      },
      reviewRequest: { instruction: "Ask in #reviews for {url}" },
      autoMerge: { labels: ["automerge"] },
    });
    const text = shipContext({
      config: c,
      configPath: "/repo/.pr-autopilot.yaml",
      root: "/repo",
      health,
      exists,
    });
    expect(text).toContain("- Config: /repo/.pr-autopilot.yaml (acme/widgets)");
    expect(text).toContain("- Read before implementing: /repo/CLAUDE.md");
    expect(text).toContain("- Not present: AGENTS.md");
    expect(text).toContain("- Load these skills first: team-standards");
    expect(text).toContain("- PR body template: /repo/.github/pull_request_template.md");
    expect(text).toContain(
      "- Review request: instruction (shown by `pr-autopilot request-review`)",
    );
    expect(text).toContain(
      "- Auto-merge: off unless the user asks or the PR has a label in [automerge]",
    );
    expect(text).toContain("- Daemon: running (gh-webhook-forward connected)");
  });

  test("works without a config", () => {
    const text = shipContext({
      config: null,
      configPath: null,
      root: "/repo",
      health: null,
      exists,
    });
    expect(text).toContain("- Config: none found; run `pr-autopilot init` to create one");
    expect(text).toContain("- Daemon: not running; start it with `pr-autopilot daemon start`");
    expect(text).toContain(
      "- PR body template: none; match the conventions of recently merged PRs",
    );
  });
});
