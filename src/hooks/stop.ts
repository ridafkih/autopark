import {
  actionItemsFor,
  decideStop,
  isHeld,
  viewsInScope,
  type TrackedView,
} from "../core/stop.ts";
import { configOrDefaults, type HookState } from "./state.ts";

export interface StopHookState extends HookState {
  stopHookActive: boolean;
  priorBlocks: number;
  priorMark?: number;
}

export interface StopHookResult {
  output: object | null;
  blocks: number;
  mark: number;
}

const DAEMON_DOWN =
  "autopark: the daemon is not running, so tracked PR state may be stale; start it with `autopark daemon start`.";

const nudgeMark = (views: TrackedView[]) =>
  Math.max(0, ...views.map((view) => view.nudge?.lastNudgeAt ?? 0));

export function stopHook(state: StopHookState): StopHookResult {
  const config = configOrDefaults(state.config).hooks.stop;
  if (!config.enabled) return { output: null, blocks: 0, mark: 0 };
  const scope = { sessionId: state.sessionId, repos: state.config?.repos ?? [] };
  const scoped = viewsInScope(state.views, config.scope, scope).filter((view) => !isHeld(view));
  const mark = nudgeMark(scoped);
  if (scoped.length === 0) return { output: null, blocks: 0, mark };
  if (!state.health) return { output: { systemMessage: DAEMON_DOWN }, blocks: 0, mark };
  const decision = decideStop({
    items: scoped.flatMap((view) => actionItemsFor(view, config)),
    stopHookActive: state.stopHookActive,
    priorBlocks: mark > (state.priorMark ?? 0) ? 0 : state.priorBlocks,
    maxBlocks: config.maxBlocks,
  });
  const { blocks } = decision;
  if (decision.decision === "block") {
    const reason = `${decision.reason}\nUse ${state.playbook}.`;
    return { output: { decision: "block", reason }, blocks, mark };
  }
  if (decision.systemMessage) {
    return { output: { systemMessage: decision.systemMessage }, blocks, mark };
  }
  return { output: null, blocks, mark };
}
