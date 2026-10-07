import { describe, expect, test } from "bun:test";
import type { HookState } from "../src/hooks/state.ts";
import { stopHook } from "../src/hooks/stop.ts";
import { config } from "./fixtures/build.ts";
import { hookState, PLAYBOOK, view } from "./fixtures/hook-state.ts";

interface Continuation {
  stopHookActive: boolean;
  priorBlocks: number;
}

interface Expectation {
  output: "block" | "message" | null;
  blocks: number;
}

type Row = [string, Partial<HookState>, Continuation, Expectation];

const fresh: Continuation = { stopHookActive: false, priorBlocks: 0 };
const allow: Expectation = { output: null, blocks: 0 };
const conflicted = [view({ mergeable: "CONFLICTING" })];
const NEXT_STEP =
  "acme/widgets#7 conflict: conflicts with main. Next: merge main into the branch, resolve, push.";

describe("Stop hook", () => {
  test.each<Row>([
    ["ready PR lets the turn end", {}, fresh, allow],
    [
      "conflict blocks with the next step",
      { views: conflicted },
      fresh,
      { output: "block", blocks: 1 },
    ],
    [
      "continuing under the cap blocks again",
      { views: conflicted },
      { stopHookActive: true, priorBlocks: 1 },
      { output: "block", blocks: 2 },
    ],
    [
      "cap reached lets go with a message",
      { views: conflicted },
      { stopHookActive: true, priorBlocks: 3 },
      { output: "message", blocks: 0 },
    ],
    ["pending checks never block", { views: [view({ checks: [], approvals: [] })] }, fresh, allow],
    [
      "another session's conflict is out of scope",
      { views: [view({ mergeable: "CONFLICTING" }, "s2")] },
      fresh,
      allow,
    ],
    [
      "daemon down warns instead of blocking on stale state",
      { views: conflicted, health: null },
      fresh,
      { output: "message", blocks: 0 },
    ],
    [
      "disabled in config",
      { views: conflicted, config: config({ hooks: { stop: { enabled: false } } }) },
      fresh,
      allow,
    ],
    [
      "no config uses session scope defaults",
      { views: conflicted, config: null },
      fresh,
      { output: "block", blocks: 1 },
    ],
  ])("%s", (label, overrides, continuation, expected) => {
    const result = stopHook({ ...hookState(overrides), ...continuation });
    expect(result.blocks).toBe(expected.blocks);
    if (expected.output === null) expect(result.output).toBeNull();
    if (expected.output === "block") {
      expect(result.output).toMatchObject({ decision: "block" });
      const { reason } = result.output as { reason?: string };
      expect(reason).toContain(NEXT_STEP);
      expect(reason).toContain(PLAYBOOK);
    }
    if (expected.output === "message") {
      expect(Object.keys(result.output ?? {})).toEqual(["systemMessage"]);
    }
  });
});
