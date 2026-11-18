import type { Evaluation, MergeQueueEntry } from "./types.ts";

export const isQueued = (evaluation: Evaluation | null | undefined) =>
  Boolean(evaluation?.mergeQueue);

export function describeQueuePosition({
  state,
  position,
}: Pick<MergeQueueEntry, "state" | "position">) {
  return position === null ? state : `position ${position}, ${state}`;
}

export function removalReasonSince(next: Evaluation, enqueuedAt: string | null) {
  const removal = next.queueRemoval;
  if (!removal?.at) return null;
  if (enqueuedAt !== null && removal.at < enqueuedAt) return null;
  return removal.reason;
}
