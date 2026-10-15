import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeHeartbeat, writeHeartbeat, type Heartbeat } from "../src/channel/heartbeat.ts";
import { stringAt } from "../src/core/json.ts";
import { resolvePaths } from "../src/daemon/paths.ts";
import { hookState as readHookState } from "../src/hooks/run.ts";
import { DELIVERY_DOWN, stopHook } from "../src/hooks/stop.ts";
import { hookState, view } from "./fixtures/hook-state.ts";

const beat = (changes: Partial<Heartbeat> = {}): Heartbeat => ({
  kind: "channel",
  pid: process.pid,
  sessionId: "s1",
  startedAt: 1,
  ...changes,
});

function project() {
  const paths = resolvePaths(join(mkdtempSync(join(tmpdir(), "apl-stop-delivery-")), "home"));
  mkdirSync(paths.home, { recursive: true });
  return { paths };
}

describe("Stop hook when nothing can wake the session", () => {
  const fresh = { stopHookActive: false, priorBlocks: 0 };

  test("blocks with the reconnect step even when no PR needs action", () => {
    const result = stopHook({ ...hookState({ isDeliveryLive: false }), ...fresh });
    expect(result.output).toMatchObject({ decision: "block" });
    expect(stringAt(result.output, "reason")).toBe(DELIVERY_DOWN);
    expect(result.blocks).toBe(1);
  });

  test("lists the PR actions after the delivery warning", () => {
    const views = [view({ mergeable: "CONFLICTING" })];
    const result = stopHook({ ...hookState({ isDeliveryLive: false, views }), ...fresh });
    expect(stringAt(result.output, "reason")).toBe(
      `${DELIVERY_DOWN}\nAct on these PRs per the autopark playbook; only \`autopark hold\` pauses PR work.\n#7 conflict`,
    );
  });

  test("is never answered with a no-change brief", () => {
    const state = { ...hookState({ isDeliveryLive: false }), ...fresh };
    const first = stopHook(state);
    const second = stopHook({ ...state, priorBrief: first.brief });
    expect(stringAt(second.output, "reason")).toBe(DELIVERY_DOWN);
  });

  test("lets go with a message at the continuation cap", () => {
    const state = hookState({ isDeliveryLive: false });
    const result = stopHook({ ...state, stopHookActive: true, priorBlocks: 3 });
    expect(result.output).toEqual({ systemMessage: DELIVERY_DOWN });
  });

  test("stays quiet for a session that drives no PRs", () => {
    const views = [view({}, "s2")];
    const result = stopHook({ ...hookState({ isDeliveryLive: false, views }), ...fresh });
    expect(result.output).toBeNull();
  });

  test("reads delivery liveness for the hook's session from heartbeats", async () => {
    const { paths } = project();
    const isLive = async () => {
      const state = await readHookState({ cwd: paths.home, session_id: "s1" }, paths);
      return state.isDeliveryLive;
    };
    expect(await isLive()).toBe(false);
    writeHeartbeat(paths, beat());
    expect(await isLive()).toBe(true);
    removeHeartbeat(paths, "channel", process.pid);
    writeHeartbeat(paths, beat({ sessionId: "s2" }));
    expect(await isLive()).toBe(false);
  });
});
