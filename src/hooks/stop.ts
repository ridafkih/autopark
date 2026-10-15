import {
  actionItemsFor,
  decideStop,
  isHeld,
  viewsInScope,
  type StopDecision,
  type TrackedView,
} from "../core/stop.ts";
import type { ReviewRequestTiming } from "../core/approval-request.ts";
import { configOrDefaults, type HookState } from "./state.ts";
import {
  BRIEF_REASON,
  briefing,
  fingerprintOf,
  FORGOTTEN,
  type BriefMemory,
} from "./stop-brief.ts";

export interface StopHookState extends HookState {
  stopHookActive: boolean;
  priorBlocks: number;
  priorMark?: number;
  priorBrief?: BriefMemory;
}

export interface StopHookResult {
  output: object | null;
  blocks: number;
  mark: number;
  brief: BriefMemory;
}

type StopConfig = ReturnType<typeof configOrDefaults>["hooks"]["stop"];

const DAEMON_DOWN =
  "autopark: the daemon is not running, so tracked PR state may be stale; start it with `autopark daemon start`.";

const nudgeMark = (views: TrackedView[]) =>
  Math.max(0, ...views.map((view) => view.nudge?.lastNudgeAt ?? 0));

interface BlockContext {
  state: StopHookState;
  decision: StopDecision;
  views: TrackedView[];
  config: StopConfig;
  when: ReviewRequestTiming;
}

const priorBriefOf = (state: StopHookState) => state.priorBrief ?? FORGOTTEN;

function blockOutput({ state, decision, views, config, when }: BlockContext) {
  const prior = priorBriefOf(state);
  const maxBriefs = views.some((view) => view.stale) ? 0 : config.maxBriefs;
  const { isBrief, memory } = briefing(fingerprintOf(views, config, when), prior, maxBriefs);
  const reason = isBrief ? BRIEF_REASON : decision.reason;
  return { output: { decision: "block", reason }, brief: memory };
}

export function stopHook(state: StopHookState): StopHookResult {
  const {
    hooks: { stop: config },
    reviewRequest: { when },
  } = configOrDefaults(state.config);
  if (!config.enabled) return { output: null, blocks: 0, mark: 0, brief: FORGOTTEN };
  const scope = { sessionId: state.sessionId, repos: state.config?.repos ?? [] };
  const scoped = viewsInScope(state.views, config.scope, scope).filter((view) => !isHeld(view));
  const mark = nudgeMark(scoped);
  if (scoped.length === 0) return { output: null, blocks: 0, mark, brief: FORGOTTEN };
  const prior = priorBriefOf(state);
  if (!state.health) {
    return { output: { systemMessage: DAEMON_DOWN }, blocks: 0, mark, brief: prior };
  }
  const decision = decideStop({
    items: scoped.flatMap((view) => actionItemsFor(view, config, when)),
    stopHookActive: state.stopHookActive,
    priorBlocks: mark > (state.priorMark ?? 0) ? 0 : state.priorBlocks,
    maxBlocks: config.maxBlocks,
  });
  const { blocks, systemMessage } = decision;
  if (decision.decision === "block") {
    return { ...blockOutput({ state, decision, views: scoped, config, when }), blocks, mark };
  }
  if (systemMessage) return { output: { systemMessage }, blocks, mark, brief: prior };
  return { output: null, blocks, mark, brief: FORGOTTEN };
}
