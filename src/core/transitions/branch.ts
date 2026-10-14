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
