import type { Config } from "../config/schema.ts";
import { NUDGE_KINDS, type Evaluation, type NudgeKind } from "./types.ts";

type NudgeConfig = Config["nudge"];

export interface NudgeState {
  signature: string;
  since: number;
  headMovedAt: number | null;
  lastNudgeAt: number | null;
  count: number;
  next: string | null;
}

const READY_SIGNATURE = "ready";

const isNudgeKind = (value: string): value is NudgeKind =>
  NUDGE_KINDS.some((kind) => kind === value);

export function nudgeKindsOf(evaluation: Evaluation): NudgeKind[] {
  const codes = evaluation.reasons.flatMap((reason) =>
    isNudgeKind(reason.code) ? [reason.code] : [],
  );
  const kinds: NudgeKind[] = evaluation.awaitingHuman ? [...codes, "awaiting_human"] : codes;
  return [...new Set(kinds)];
}

const signatureOf = (evaluation: Evaluation) =>
  evaluation.ready ? READY_SIGNATURE : nudgeKindsOf(evaluation).toSorted().join(",");

const headMovedAt = (
  state: NudgeState | null,
  previous: Evaluation | null,
  next: Evaluation,
  now: number,
) => (previous && previous.headSha !== next.headSha ? now : (state?.headMovedAt ?? null));

export function trackNudge(
  state: NudgeState | null,
  previous: Evaluation | null,
  next: Evaluation,
  now: number,
): NudgeState | null {
  if (next.state !== "OPEN") return null;
  const signature = signatureOf(next);
  const movedAt = headMovedAt(state, previous, next, now);
  if (state?.signature === signature) return { ...state, headMovedAt: movedAt };
  return { signature, since: now, headMovedAt: movedAt, lastNudgeAt: null, count: 0, next: null };
}

export const markNudged = (state: NudgeState, now: number, next: string): NudgeState => ({
  ...state,
  lastNudgeAt: now,
  count: state.count + 1,
  next,
});

export function shouldNudge(evaluation: Evaluation, config: NudgeConfig) {
  if (evaluation.state !== "OPEN") return false;
  if (evaluation.ready) return config.nudgeReadyUnmerged;
  const kinds = nudgeKindsOf(evaluation);
  if (kinds.includes("draft") && !config.kinds.includes("draft")) return false;
  return kinds.some((kind) => config.kinds.includes(kind));
}

export function nextNudgeAt(
  state: NudgeState,
  evaluation: Evaluation,
  config: NudgeConfig,
  heldUntil: number | null,
): number | null {
  if (!shouldNudge(evaluation, config)) return null;
  const scheduled =
    state.lastNudgeAt === null ? state.since + config.after : state.lastNudgeAt + config.every;
  const quietUntil =
    config.quietWhenHeadMoving && state.headMovedAt !== null
      ? state.headMovedAt + config.after
      : scheduled;
  return Math.max(scheduled, quietUntil, heldUntil ?? scheduled);
}

export const isEscalated = (state: NudgeState, config: NudgeConfig, now: number) =>
  config.escalateAfter !== null && now - state.since >= config.escalateAfter;
