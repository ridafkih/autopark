import { existsSync } from "node:fs";
import { cwdConfig } from "../channel/context.ts";
import { playbookRef } from "../channel/playbook.ts";
import { activeHold } from "../core/hold.ts";
import { isRecord, parseJson } from "../core/json.ts";
import type { TrackedView } from "../core/stop.ts";
import { daemonHealth } from "../daemon/client.ts";
import { resolvePaths, type Paths } from "../daemon/paths.ts";
import { Store } from "../daemon/store.ts";
import { sessionStartContext } from "./session-start.ts";
import type { HookState } from "./state.ts";
import { readStopState, writeStopState } from "./stop-state.ts";
import { stopHook } from "./stop.ts";

export interface HookInput {
  cwd?: unknown;
  session_id?: unknown;
  stop_hook_active?: unknown;
}

export function readViews(db: string, now: number): TrackedView[] {
  if (!existsSync(db)) return [];
  const store = new Store(db, { readonly: true });
  try {
    const holds = store.listHolds();
    return store.listPullRequests({ trackedOnly: true }).flatMap((record) =>
      record.evaluation
        ? [
            {
              evaluation: record.evaluation,
              sessionId: record.sessionId,
              reviewRequestedHead: record.reviewRequestedHead,
              nudge: record.nudge,
              hold: activeHold(record.key, holds, now),
            },
          ]
        : [],
    );
  } finally {
    store.close();
  }
}

export async function hookState(input: HookInput, paths: Paths): Promise<HookState> {
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const { config, path } = await cwdConfig(cwd);
  const now = Date.now();
  return {
    health: await daemonHealth(paths.socket),
    views: readViews(paths.db, now),
    now,
    config,
    sessionId: typeof input.session_id === "string" ? input.session_id : null,
    playbook: playbookRef(config, path),
  };
}

function sessionStartOutput(state: HookState) {
  const context = sessionStartContext(state);
  if (!context) return null;
  const output = { hookEventName: "SessionStart", additionalContext: context };
  return JSON.stringify({ hookSpecificOutput: output });
}

function stopOutput(state: HookState, input: HookInput, paths: Paths) {
  const key = state.sessionId ?? "unknown";
  const prior = readStopState(paths)[key];
  const result = stopHook({
    ...state,
    stopHookActive: input.stop_hook_active === true,
    priorBlocks: prior?.blocks ?? 0,
    priorMark: prior?.mark ?? 0,
  });
  if (existsSync(paths.home)) {
    writeStopState(paths, key, { blocks: result.blocks, mark: result.mark });
  }
  return result.output ? JSON.stringify(result.output) : null;
}

export async function runHook(kind: string, stdin: string): Promise<string | null> {
  const parsed = stdin.trim() ? parseJson(stdin) : {};
  const input: HookInput = isRecord(parsed) ? parsed : {};
  const paths = resolvePaths();
  const state = await hookState(input, paths);
  if (kind === "session-start") return sessionStartOutput(state);
  if (kind === "stop") return stopOutput(state, input, paths);
  throw new Error(`unknown hook ${kind}`);
}
