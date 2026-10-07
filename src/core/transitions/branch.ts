import type { Detector } from "./context.ts";
import { describeSha } from "./context.ts";

export const detectHeadMoved: Detector = ({ previous, next, emit }) => {
  if (!previous || previous.headSha === next.headSha) return [];
  const reason = `head moved ${describeSha(previous.headSha)} → ${describeSha(next.headSha)}`;
  return [emit("head_moved", reason, { from: previous.headSha, to: next.headSha })];
};

export const detectConflict: Detector = ({ previous, next, emit }) => {
  const previousKnown = previous?.lastKnownMergeable ?? "UNKNOWN";
  if (next.mergeable === "CONFLICTING" && previousKnown !== "CONFLICTING") {
    const data = { base: next.baseRef, mergeStateStatus: next.mergeStateStatus };
    return [emit("conflicted", `conflicts with ${next.baseRef}`, data)];
  }
  if (next.mergeable === "MERGEABLE" && previousKnown === "CONFLICTING") {
    const reason = `no longer conflicts with ${next.baseRef}`;
    return [emit("conflict_resolved", reason, { base: next.baseRef })];
  }
  return [];
};

export const detectMergeabilityUnknown: Detector = ({ previous, next, options, emit }) => {
  const isExhausted = options.mergeabilityExhausted === true;
  if (next.mergeable !== "UNKNOWN" || !isExhausted || previous?.mergeable === "UNKNOWN") return [];
  const reason = "GitHub did not compute mergeability within the backoff window";
  return [emit("mergeability_unknown", reason, { lastKnown: next.lastKnownMergeable })];
};

export const detectStaleBase: Detector = ({ sameHeadPrevious, next, emit }) => {
  const wasStale =
    sameHeadPrevious?.base.stale === true && sameHeadPrevious.base.sha === next.base.sha;
  if (!next.base.stale || wasStale) return [];
  const staleReason = next.reasons.find((reason) => reason.code === "stale_base");
  return [
    emit("stale_base", staleReason?.detail ?? `behind ${next.baseRef}`, {
      base: next.baseRef,
      baseSha: next.base.sha,
      behindBy: next.base.behindBy,
      touched: next.base.touched,
      policy: next.base.policy,
    }),
  ];
};
