import { describe, expect, test } from "bun:test";
import { actionableItems, decideStop, type StopInput } from "../src/core/stop.ts";
import { stopConfig, view } from "./fixtures/stop-views.ts";

const input = (
  stopItems: StopInput["items"],
  isStopHookActive: boolean,
  priorBlocks: number,
): StopInput => ({
  items: stopItems,
  stopHookActive: isStopHookActive,
  priorBlocks,
  maxBlocks: 3,
});

describe("scope", () => {
  const mine = view({ mergeable: "CONFLICTING" }, { sessionId: "s1" });
  const other = {
    ...view({ mergeable: "CONFLICTING", number: 8 }),
    sessionId: "s2",
  };
  const elsewhere = {
    ...view({ mergeable: "CONFLICTING", number: 9, repo: "acme/other" }),
    sessionId: null,
  };
  const all = [mine, other, elsewhere];
  test.each([
    ["session", ["acme/widgets#7"]],
    ["repo", ["acme/widgets#7", "acme/widgets#8"]],
    ["all", ["acme/widgets#7", "acme/widgets#8", "acme/other#9"]],
  ] as const)("scope %s", (scope, expected) => {
    const items = actionableItems(
      all,
      { ...stopConfig.hooks.stop, scope },
      { sessionId: "s1", repos: ["Acme/Widgets"] },
    );
    expect(items.map((item) => item.pr)).toEqual([...expected]);
  });
});

describe("decideStop", () => {
  const items = actionableItems([view({ mergeable: "CONFLICTING" })], stopConfig.hooks.stop, {
    sessionId: "s1",
    repos: [],
  });

  test.each([
    ["nothing actionable allows and resets", input([], false, 2), { decision: "allow", blocks: 0 }],
    ["first block", input(items, false, 0), { decision: "block", blocks: 1 }],
    ["fresh stop resets the counter", input(items, false, 5), { decision: "block", blocks: 1 }],
    [
      "continuing under the cap blocks again",
      input(items, true, 1),
      { decision: "block", blocks: 2 },
    ],
    ["cap reached allows", input(items, true, 3), { decision: "allow", blocks: 0 }],
    ["over the cap allows", input(items, true, 7), { decision: "allow", blocks: 0 }],
  ] as const)("%s", (label, stopInput, expected) => {
    expect(decideStop(stopInput)).toMatchObject(expected);
  });

  test("block reason is factual and lists each PR with its next step", () => {
    const decision = decideStop(input(items, false, 0));
    expect(decision.reason).toBe(
      "Tracked PRs have actionable items:\n- acme/widgets#7 conflict: conflicts with main. Next: merge main into the branch, resolve, push.",
    );
  });

  test("cap reached explains why it let go", () => {
    const decision = decideStop(input(items, true, 3));
    expect(decision.systemMessage).toContain("3");
  });
});
