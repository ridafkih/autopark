import { actionItemsFor, decideStop, viewsInScope } from "../core/stop.ts";
import { configOrDefaults, type HookState } from "./state.ts";

export interface StopHookState extends HookState {
  stopHookActive: boolean;
  priorBlocks: number;
}

export interface StopHookResult {
  output: object | null;
  blocks: number;
}

const DAEMON_DOWN =
  "autopark: the daemon is not running, so tracked PR state may be stale; start it with `autopark daemon start`.";

export function stopHook(state: StopHookState): StopHookResult {
  const config = configOrDefaults(state.config).hooks.stop;
  if (!config.enabled) return { output: null, blocks: 0 };
  const scope = { sessionId: state.sessionId, repos: state.config?.repos ?? [] };
  const scoped = viewsInScope(state.views, config.scope, scope);
  if (scoped.length === 0) return { output: null, blocks: 0 };
  if (!state.health) return { output: { systemMessage: DAEMON_DOWN }, blocks: 0 };
  const decision = decideStop({
    items: scoped.flatMap((view) => actionItemsFor(view, config)),
    stopHookActive: state.stopHookActive,
    priorBlocks: state.priorBlocks,
    maxBlocks: config.maxBlocks,
  });
  if (decision.decision === "block") {
    const reason = `${decision.reason}\nUse ${state.playbook}.`;
    return { output: { decision: "block", reason }, blocks: decision.blocks };
  }
  if (decision.systemMessage) {
    return { output: { systemMessage: decision.systemMessage }, blocks: decision.blocks };
  }
  return { output: null, blocks: decision.blocks };
}
