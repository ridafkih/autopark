import {
  detectConflict,
  detectHeadMoved,
  detectMergeabilityUnknown,
  detectStaleBase,
} from "./transitions/branch.ts";
import { detectChecksFailed, detectChecksPassed } from "./transitions/checks.ts";
import { diffContext, type Detector, type DiffOptions } from "./transitions/context.ts";
import {
  detectApprovalStale,
  detectApprovedOnHead,
  detectReviewScored,
  detectThreadsOpen,
} from "./transitions/reviews.ts";
import type { Evaluation, Transition } from "./types.ts";

export type { DiffOptions } from "./transitions/context.ts";

const detectClosed: Detector = ({ previous, next, emit }) => {
  if (previous?.state === next.state) return [];
  if (next.state === "MERGED") return [emit("merged", `#${next.number} was merged`)];
  return [emit("closed", `#${next.number} was closed without merging`)];
};

const detectAwaitingHuman: Detector = ({ sameHeadPrevious, next, emit }) => {
  if (!next.awaitingHuman || sameHeadPrevious?.awaitingHuman) return [];
  const reason = "everything is green except human approval";
  return [emit("awaiting_human", reason, { reasons: next.reasons })];
};

const detectReadiness: Detector = ({ previous, next, emit }) => {
  if (next.ready && !previous?.ready) {
    const suffix = next.mergeableNow ? "; mergeable now" : "";
    const reason = `all readiness rules pass${suffix}`;
    return [emit("ready", reason, { mergeableNow: next.mergeableNow })];
  }
  if (!next.ready && (previous === null || previous.ready)) {
    const reason = next.reasons.map((entry) => entry.detail).join("; ");
    return [emit("not_ready", reason, { reasons: next.reasons })];
  }
  return [];
};

const OPEN_DETECTORS: Detector[] = [
  detectHeadMoved,
  detectConflict,
  detectMergeabilityUnknown,
  detectStaleBase,
  detectChecksFailed,
  detectChecksPassed,
  detectReviewScored,
  detectThreadsOpen,
  detectApprovedOnHead,
  detectApprovalStale,
  detectAwaitingHuman,
  detectReadiness,
];

export function diff(
  previous: Evaluation | null,
  next: Evaluation,
  options: DiffOptions = {},
): Transition[] {
  const context = diffContext(previous, next, options);
  if (next.state !== "OPEN") return detectClosed(context);
  return OPEN_DETECTORS.flatMap((detect) => detect(context));
}
