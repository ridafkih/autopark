import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson, stringAt } from "../src/core/json.ts";
import { STOP_HEADER, type TrackedView } from "../src/core/stop.ts";
import type { Snapshot } from "../src/core/types.ts";
import { resolvePaths } from "../src/daemon/paths.ts";
import { stopOutput } from "../src/hooks/run.ts";
import { check, config, greptileComment, HEAD, HEAD2 } from "./fixtures/build.ts";
import { hookState, view } from "./fixtures/hook-state.ts";

const BRIEF = "No change since last check.";
const MINUTE = 60_000;

const conflict: Partial<Snapshot> = { mergeable: "CONFLICTING" };
const failing: Partial<Snapshot> = { checks: [check("build", "fail"), check("gate", "pass")] };

function stopper(overrides: { config?: ReturnType<typeof config> } = {}) {
  const paths = resolvePaths(mkdtempSync(join(tmpdir(), "apl-brief-")));
  return (views: TrackedView[], sessionId = "s1") => {
    const state = hookState({ views, sessionId, ...overrides });
    const output = stopOutput(state, { stop_hook_active: false }, paths);
    return output === null ? null : parseJson(output);
  };
}

const reasonOf = (output: unknown) => stringAt(output, "reason");

const isFull = (output: unknown) =>
  stringAt(output, "decision") === "block" && reasonOf(output)?.startsWith(STOP_HEADER) === true;

const isBrief = (output: unknown) =>
  stringAt(output, "decision") === "block" && reasonOf(output) === BRIEF;

describe("Stop hook brief mode", () => {
  test("the first call prints the full list", () => {
    const stop = stopper();
    const output = stop([view(conflict)]);
    expect(isFull(output)).toBe(true);
    expect(reasonOf(output)).toEndWith("\n#7 conflict");
  });

  test("an identical second call is one brief line that still blocks", () => {
    const stop = stopper();
    stop([view(conflict)]);
    expect(stop([view(conflict)])).toEqual({ decision: "block", reason: BRIEF });
  });

  test("a repeated nudge alone is no change", () => {
    const stop = stopper();
    const nudge = { signature: "x", since: 0, headMovedAt: null, lastNudgeAt: 1, next: null };
    stop([
      { ...view({ approvals: [] }), reviewRequestedHead: HEAD, nudge: { ...nudge, count: 1 } },
    ]);
    const again = {
      ...view({ approvals: [] }),
      reviewRequestedHead: HEAD,
      nudge: { ...nudge, count: 2 },
    };
    expect(isBrief(stop([again]))).toBe(true);
  });

  test("a changed score prints the full list again", () => {
    const stop = stopper();
    stop([view({ comments: [greptileComment(2, HEAD)] })]);
    expect(isFull(stop([view({ comments: [greptileComment(3, HEAD)] })]))).toBe(true);
  });

  test("a new kind prints the full list again", () => {
    const stop = stopper();
    stop([view(conflict)]);
    expect(isFull(stop([view({ ...conflict, ...failing })]))).toBe(true);
    expect(isBrief(stop([view({ ...conflict, ...failing })]))).toBe(true);
  });

  test("a new PR prints the full list again", () => {
    const stop = stopper();
    stop([view(conflict)]);
    const output = stop([view(conflict), view({ ...conflict, number: 8 })]);
    expect(isFull(output)).toBe(true);
    expect(reasonOf(output)).toContain("\n#8 conflict");
  });

  test("a resolved item prints the full list again", () => {
    const stop = stopper();
    stop([view({ ...conflict, ...failing })]);
    const output = stop([view(conflict)]);
    expect(isFull(output)).toBe(true);
    expect(reasonOf(output)).not.toContain("checks:");
  });

  test("a new head prints the full list again", () => {
    const stop = stopper();
    stop([view(failing)]);
    expect(isFull(stop([view({ ...failing, headSha: HEAD2 })]))).toBe(true);
  });

  test("the full list returns after the default 10 brief calls", () => {
    const stop = stopper();
    const outputs = Array.from({ length: 13 }, () => stop([view(conflict)]));
    const shapes = outputs.map((output): string => (isFull(output) ? "full" : "brief"));
    expect(shapes).toEqual(["full", ...Array.from({ length: 10 }, () => "brief"), "full", "brief"]);
  });

  test("hooks.stop.maxBriefs sets how many brief calls come between full ones", () => {
    const stop = stopper({ config: config({ hooks: { stop: { maxBriefs: 2 } } }) });
    const outputs = Array.from({ length: 5 }, () => stop([view(conflict)]));
    const shapes = outputs.map((output): string => (isFull(output) ? "full" : "brief"));
    expect(shapes).toEqual(["full", "brief", "brief", "full", "brief"]);
  });

  test("sessions are isolated from each other", () => {
    const stop = stopper();
    const views = [view(conflict, "s1"), view(conflict, "s2")];
    expect(isFull(stop(views, "s1"))).toBe(true);
    expect(isFull(stop(views, "s2"))).toBe(true);
    expect(isBrief(stop(views, "s1"))).toBe(true);
    expect(isBrief(stop(views, "s2"))).toBe(true);
  });

  test("a hold keeps the PR out of the hook, and releasing it prints the full list", () => {
    const stop = stopper();
    const hold = { until: 30 * MINUTE, reason: "design", scope: "pr" as const };
    stop([view(conflict)]);
    expect(stop([{ ...view(conflict), hold }])).toBeNull();
    expect(isFull(stop([view(conflict)]))).toBe(true);
  });
});
