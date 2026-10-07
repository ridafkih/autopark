import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cwdConfig } from "../channel/context.ts";
import { playbookRef } from "../channel/playbook.ts";
import type { TrackedView } from "../core/stop.ts";
import { daemonHealth } from "../daemon/daemon.ts";
import { paths, type Paths } from "../daemon/paths.ts";
import { Store } from "../daemon/store.ts";
import { sessionStartContext, stopHook, type HookState } from "./logic.ts";

export function readViews(db: string): TrackedView[] {
  if (!existsSync(db)) return [];
  const store = new Store(db, { readonly: true });
  try {
    return store
      .listPrs({ trackedOnly: true })
      .filter((r) => r.evaluation)
      .map((r) => ({
        evaluation: r.evaluation!,
        sessionId: r.sessionId,
        reviewRequestedHead: r.reviewRequestedHead,
      }));
  } finally {
    store.close();
  }
}

function readStopState(p: Paths): Record<string, number> {
  try {
    return JSON.parse(readFileSync(p.stopState, "utf8"));
  } catch {
    return {};
  }
}

function writeStopState(p: Paths, sessionId: string, blocks: number) {
  const s = readStopState(p);
  if (blocks) s[sessionId] = blocks;
  else delete s[sessionId];
  const entries = Object.entries(s).slice(-200);
  writeFileSync(p.stopState, JSON.stringify(Object.fromEntries(entries)));
}

export async function hookState(input: any, p: Paths): Promise<HookState> {
  const { config, path } = await cwdConfig(
    typeof input.cwd === "string" ? input.cwd : process.cwd(),
  );
  return {
    health: await daemonHealth(p.socket),
    views: readViews(p.db),
    config,
    sessionId: typeof input.session_id === "string" ? input.session_id : null,
    playbook: playbookRef(config, path),
  };
}

export async function runHook(kind: string, stdin: string): Promise<string | null> {
  const input = stdin.trim() ? JSON.parse(stdin) : {};
  const p = paths();
  const s = await hookState(input, p);
  if (kind === "session-start") {
    const ctx = sessionStartContext(s);
    return ctx
      ? JSON.stringify({
          hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
        })
      : null;
  }
  if (kind === "stop") {
    const key = s.sessionId ?? "unknown";
    const r = stopHook({
      ...s,
      stopHookActive: input.stop_hook_active === true,
      priorBlocks: readStopState(p)[key] ?? 0,
    });
    if (existsSync(p.home)) writeStopState(p, key, r.blocks);
    return r.output ? JSON.stringify(r.output) : null;
  }
  throw new Error(`unknown hook ${kind}`);
}
