import type { Config } from "../config/schema.ts";
import {
  APPROVAL_CODES,
  isApprovalRequestDue,
  reviewStep,
  type ReviewStep,
} from "./approval-request.ts";
import { formatDuration } from "./duration.ts";
import { ALL_PULL_REQUESTS, type Hold } from "./hold.ts";
import { isEscalated, nudgeKindsOf, type NudgeState } from "./nudge.ts";
import type { Evaluation, NudgeKind, Transition, TransitionKind } from "./types.ts";

export const PAUSE_RULE =
  "A declined tool call or a quiet conversation does not pause PR work. Only `autopark hold` does.";

const NEXT_STEPS: Record<NudgeKind, string> = {
  draft: "mark it ready for review once the work is done",
  conflict: "merge the base in, resolve, push",
  mergeability_unknown: "run `autopark check` once to re-read it",
  checks_failed: "read the failing logs, fix the cause, push",
  checks_pending: "confirm the pending checks are running and rerun any that are stuck",
  review_missing: "make sure the reviewer bot has been triggered on the head",
  review_stale: "make sure the reviewer bot re-reviews the current head",
  review_below_threshold: "address the review findings, push",
  threads_open: "address, reply to and resolve each open thread",
  changes_requested: "address the requested changes, push, ask for re-review",
  approval_missing: "request review",
  approval_stale: "request review on the current head",
  human_gate_pending: "tell the user a human gate is waiting",
  awaiting_human: "request review",
};

const isApprovalKind = (kind: NudgeKind) => kind === "awaiting_human" || APPROVAL_CODES.has(kind);

function otherSteps(evaluation: Evaluation) {
  const kinds = nudgeKindsOf(evaluation).filter((kind) => !isApprovalKind(kind));
  return [...new Set(kinds.map((kind) => NEXT_STEPS[kind]))];
}

function stepFor(evaluation: Evaluation, config: Config, requestedHead: string | null): ReviewStep {
  if (evaluation.ready) {
    return { text: "tell the user it is ready to merge", instruction: null, isRequested: false };
  }
  const others = otherSteps(evaluation);
  if (!isApprovalRequestDue(evaluation, requestedHead)) {
    return { text: others.join("; "), instruction: null, isRequested: false };
  }
  const review = reviewStep(evaluation, config.reviewRequest);
  return { ...review, text: [review.text, ...others].join("; ") };
}

export const nextStep = (evaluation: Evaluation, config: Config, requestedHead: string | null) =>
  stepFor(evaluation, config, requestedHead).text;

function situation(evaluation: Evaluation, blockedFor: string) {
  if (evaluation.ready) return `ready for ${blockedFor} and not merged`;
  if (evaluation.awaitingHuman) return `awaiting human review for ${blockedFor}`;
  return `blocked for ${blockedFor}`;
}

const blockingDetails = (evaluation: Evaluation) =>
  evaluation.reasons.map((reason) => reason.detail).join("; ");

const transitionFor = (
  kind: TransitionKind,
  evaluation: Evaluation,
  reason: string,
  data: Record<string, unknown>,
): Transition => ({
  kind,
  repo: evaluation.repo,
  number: evaluation.number,
  head: evaluation.headSha || null,
  reason,
  data,
});

export interface NudgeInput {
  evaluation: Evaluation;
  state: NudgeState;
  config: Config;
  now: number;
  requestedHead: string | null;
}

function nudgeReason({ evaluation, state, config, now }: NudgeInput, next: string) {
  const kinds = nudgeKindsOf(evaluation);
  const headline = situation(evaluation, formatDuration(now - state.since));
  const loud = isEscalated(state, config.nudge, now) ? `ESCALATED: ${headline}` : headline;
  const blockers = kinds.length > 0 ? ` on ${kinds.join(", ")}` : "";
  const details = blockingDetails(evaluation);
  const detailPart = details ? `: ${details}` : "";
  const count = state.count + 1;
  return `${PAUSE_RULE} ${loud}${blockers} (nudge ${count})${detailPart}. Next: ${next}.`;
}

export function nudgeTransition(input: NudgeInput): Transition {
  const { evaluation, state, config, now, requestedHead } = input;
  const step = stepFor(evaluation, config, requestedHead);
  const blockedForMs = now - state.since;
  return transitionFor("nudge", evaluation, nudgeReason(input, step.text), {
    reasons: evaluation.reasons,
    kinds: nudgeKindsOf(evaluation),
    since: new Date(state.since).toISOString(),
    blockedForMs,
    blockedFor: formatDuration(blockedForMs),
    count: state.count + 1,
    escalated: isEscalated(state, config.nudge, now),
    reRequestReview: step.isRequested,
    instruction: step.instruction,
    next: step.text,
  });
}

export function holdExpiredTransition(
  evaluation: Evaluation,
  hold: Hold,
  config: Config,
  requestedHead: string | null,
) {
  const why = hold.reason ? ` (${hold.reason})` : "";
  const details = blockingDetails(evaluation);
  const blocking = evaluation.ready
    ? "It is ready."
    : `Blocking: ${details}. Next: ${nextStep(evaluation, config, requestedHead)}.`;
  const reason = `${PAUSE_RULE} The hold${why} has ended, so work on this PR resumes now. ${blocking}`;
  return transitionFor("hold_expired", evaluation, reason, {
    holdReason: hold.reason,
    heldUntil: new Date(hold.until).toISOString(),
    scope: hold.target === ALL_PULL_REQUESTS ? "all" : "pr",
    reasons: evaluation.reasons,
  });
}
