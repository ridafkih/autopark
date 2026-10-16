import {
  actionItemsFor,
  actionLines,
  decideStop,
  isHeld,
  STOP_HEADER,
  viewsInScope,
  type StopDecision,
  type TrackedView,
} from "../core/stop.ts";
import type { ReviewRequestTiming } from "../core/approval-request.ts";
import { configOrDefaults, type HookState } from "./state.ts";
import { fingerprintOf, FORGOTTEN, type BriefMemory } from "./stop-brief.ts";

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

export const DELIVERY_DOWN = [
  "autopark's channel is not running for this session, so approval requests, failed checks and nudges reach it only when a turn ends.",
  "Ask the user once to reconnect the autopark MCP server with /mcp.",
].join(" ");

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

function onceOutput(state: StopHookState, fingerprint: string, output: object, blocks: number) {
  const brief = { fingerprint };
  if (fingerprint === priorBriefOf(state).fingerprint) return { output: null, blocks: 0, brief };
  return { output, blocks, brief };
}

function blockOutput({ state, decision, views, config, when }: BlockContext) {
  const output = { decision: "block", reason: decision.reason };
  return onceOutput(state, fingerprintOf(views, config, when), output, decision.blocks);
}

function deliveryDownOutput({
  state,
  scoped: views,
  config,
  when,
  mark,
}: EarlyContext): StopHookResult {
  const brief = priorBriefOf(state);
  if (state.stopHookActive && state.priorBlocks >= config.maxBlocks) {
    return { output: { systemMessage: DELIVERY_DOWN }, blocks: 0, mark, brief };
  }
  const items = views.flatMap((view) => actionItemsFor(view, config, when));
  const lines = items.length > 0 ? [STOP_HEADER, ...actionLines(items)] : [];
  const blocks = state.stopHookActive ? state.priorBlocks + 1 : 1;
  const reason = [DELIVERY_DOWN, ...lines].join("\n");
  const fingerprint = `delivery_down\n${fingerprintOf(views, config, when)}`;
  return { ...onceOutput(state, fingerprint, { decision: "block", reason }, blocks), mark };
}

interface EarlyContext {
  state: StopHookState;
  scoped: TrackedView[];
  config: StopConfig;
  when: ReviewRequestTiming;
  mark: number;
}

function earlyOutput({ state, scoped, config, when, mark }: EarlyContext): StopHookResult | null {
  if (scoped.length === 0) return { output: null, blocks: 0, mark, brief: FORGOTTEN };
  if (!state.health) {
    return { output: { systemMessage: DAEMON_DOWN }, blocks: 0, mark, brief: priorBriefOf(state) };
  }
  if (state.isDeliveryLive === false) {
    return deliveryDownOutput({ state, scoped, config, when, mark });
  }
  return null;
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
  const early = earlyOutput({ state, scoped, config, when, mark });
  if (early) return early;
  const prior = priorBriefOf(state);
  const decision = decideStop({
    items: scoped.flatMap((view) => actionItemsFor(view, config, when)),
    stopHookActive: state.stopHookActive,
    priorBlocks: mark > (state.priorMark ?? 0) ? 0 : state.priorBlocks,
    maxBlocks: config.maxBlocks,
  });
  const { blocks, systemMessage } = decision;
  if (decision.decision === "block") {
    return { ...blockOutput({ state, decision, views: scoped, config, when }), mark };
  }
  if (systemMessage) return { output: { systemMessage }, blocks, mark, brief: prior };
  return { output: null, blocks, mark, brief: FORGOTTEN };
}
