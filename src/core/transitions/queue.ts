import { isQueued, removalReasonSince } from "../merge-queue.ts";
import type { MergeQueueEntry } from "../types.ts";
import type { Detector } from "./context.ts";

const where = ({ position }: MergeQueueEntry) =>
  position === null ? "" : ` at position ${position}`;

export const detectMergeQueue: Detector = ({ previous, next, emit }) => {
  const entry = next.mergeQueue;
  const previousEntry = previous?.mergeQueue;
  if (entry && !previousEntry) {
    const reason = `entered the merge queue${where(entry)} (${entry.state})`;
    const { state, position, enqueuedAt } = entry;
    return [emit("queued", reason, { state, position, enqueuedAt })];
  }
  if (!entry && previousEntry) {
    const removal = removalReasonSince(next, previousEntry.enqueuedAt);
    const suffix = removal === null ? "" : `: ${removal}`;
    const reason = `left the merge queue without merging${suffix}`;
    return [emit("dequeued", reason, { reason: removal, lastState: previousEntry.state })];
  }
  return [];
};

export const outsideQueue =
  (detect: Detector, scope: "next" | "either"): Detector =>
  (context) => {
    const isInQueue = isQueued(context.next) || (scope === "either" && isQueued(context.previous));
    return isInQueue ? [] : detect(context);
  };
