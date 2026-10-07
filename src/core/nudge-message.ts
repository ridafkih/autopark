import type { Config } from "../config/schema.ts";
import { formatDuration } from "./duration.ts";
import { formatPullRequest } from "./format.ts";
import { ALL_PULL_REQUESTS, type Hold } from "./hold.ts";
import { isEscalated, nudgeKindsOf, type NudgeState } from "./nudge.ts";
import { fillTemplate } from "./template.ts";
import type { Evaluation, NudgeKind, Transition, TransitionKind } from "./types.ts";

export const PAUSE_RULE =
  "A declined tool call or a quiet conversation does not pause PR work. Only `autopark hold` does.";

const NEXT_STEPS: Record<NudgeKind, string> = {
  draft: "mark it ready for review once the work is done",
  conflict: "merge the base in, resolve, push",
  mergeability_unknown: "run `autopark check` once to re-read it",
  stale_base: "merge the base in, re-run the affected tests, push",
  base_unknown: "run `autopark check` once to re-read the base",
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

interface ReviewStep {
  text: string;
  instruction: string | null;
  isRequested: boolean;
}

const templateVariables = (evaluation: Evaluation) => ({
  url: evaluation.url,
  number: String(evaluation.number),
  repo: evaluation.repo,
  title: evaluation.title,
  head: evaluation.headSha,
});

function reviewStep(evaluation: Evaluation, { command, instruction }: Config["reviewRequest"]) {
  const record = `\`autopark request-review ${formatPullRequest(evaluation)}\``;
  if (instruction) {
    const filled = fillTemplate(instruction, templateVariables(evaluation));
    const text = `re-request review: ${filled} Then run ${record} to record it`;
    return { text, instruction: filled, isRequested: true };
  }
  const text = command
    ? `re-request review: run ${record}`
    : "ask the user who reviews, then request review";
  return { text, instruction: null, isRequested: command !== null };
}

function stepFor(evaluation: Evaluation, config: Config): ReviewStep {
  if (evaluation.awaitingHuman) return reviewStep(evaluation, config.reviewRequest);
  const steps = nudgeKindsOf(evaluation).map((kind) => NEXT_STEPS[kind]);
  const text = evaluation.ready
    ? "tell the user it is ready to merge"
    : [...new Set(steps)].join("; ");
  return { text, instruction: null, isRequested: false };
}

export const nextStep = (evaluation: Evaluation, config: Config) =>
  stepFor(evaluation, config).text;

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
  const { evaluation, state, config, now } = input;
  const step = stepFor(evaluation, config);
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

export function holdExpiredTransition(evaluation: Evaluation, hold: Hold, config: Config) {
  const why = hold.reason ? ` (${hold.reason})` : "";
  const details = blockingDetails(evaluation);
  const blocking = evaluation.ready
    ? "It is ready."
    : `Blocking: ${details}. Next: ${nextStep(evaluation, config)}.`;
  const reason = `${PAUSE_RULE} The hold${why} has ended, so work on this PR resumes now. ${blocking}`;
  return transitionFor("hold_expired", evaluation, reason, {
    holdReason: hold.reason,
    heldUntil: new Date(hold.until).toISOString(),
    scope: hold.target === ALL_PULL_REQUESTS ? "all" : "pr",
    reasons: evaluation.reasons,
  });
}
