import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cwdConfig } from "../channel/context.ts";
import { playbookRef } from "../channel/playbook.ts";
import type { TrackedView } from "../core/stop.ts";
import { daemonHealth } from "../daemon/client.ts";
import { resolvePaths, type Paths } from "../daemon/paths.ts";
import { Store } from "../daemon/store.ts";
import { sessionStartContext } from "./session-start.ts";
import type { HookState } from "./state.ts";
import { stopHook } from "./stop.ts";

export interface HookInput {
  cwd?: unknown;
  session_id?: unknown;
  stop_hook_active?: unknown;
}

type StopState = Record<string, number>;

const MAX_REMEMBERED_SESSIONS = 200;

export function readViews(db: string): TrackedView[] {
  if (!existsSync(db)) return [];
  const store = new Store(db, { readonly: true });
  try {
    return store.listPullRequests({ trackedOnly: true }).flatMap((record) =>
      record.evaluation
        ? [
            {
              evaluation: record.evaluation,
              sessionId: record.sessionId,
              reviewRequestedHead: record.reviewRequestedHead,
            },
          ]
        : [],
    );
  } finally {
    store.close();
  }
}

function readStopState(paths: Paths): StopState {
  try {
    return JSON.parse(readFileSync(paths.stopState, "utf8")) as StopState;
  } catch {
    return {};
  }
}

function nextStopState(state: StopState, sessionId: string, blocks: number): StopState {
  if (!blocks)
    {return Object.fromEntries(Object.entries(state).filter(([key]) => key !== sessionId));}
  return { ...state, [sessionId]: blocks };
}

function writeStopState(paths: Paths, sessionId: string, blocks: number) {
  const next = nextStopState(readStopState(paths), sessionId, blocks);
  const entries = Object.entries(next).slice(-MAX_REMEMBERED_SESSIONS);
  writeFileSync(paths.stopState, JSON.stringify(Object.fromEntries(entries)));
}

export async function hookState(input: HookInput, paths: Paths): Promise<HookState> {
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const { config, path } = await cwdConfig(cwd);
  return {
    health: await daemonHealth(paths.socket),
    views: readViews(paths.db),
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
  const result = stopHook({
    ...state,
    stopHookActive: input.stop_hook_active === true,
    priorBlocks: readStopState(paths)[key] ?? 0,
  });
  if (existsSync(paths.home)) writeStopState(paths, key, result.blocks);
  return result.output ? JSON.stringify(result.output) : null;
}

export async function runHook(kind: string, stdin: string): Promise<string | null> {
  const input = (stdin.trim() ? JSON.parse(stdin) : {}) as HookInput;
  const paths = resolvePaths();
  const state = await hookState(input, paths);
  if (kind === "session-start") return sessionStartOutput(state);
  if (kind === "stop") return stopOutput(state, input, paths);
  throw new Error(`unknown hook ${kind}`);
}
