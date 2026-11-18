import { isRecord, numberAt, recordsAt, stringAt, valueAt, type JsonRecord } from "../core/json.ts";
import type { MergeQueueEntry, MergeQueueRemoval } from "../core/types.ts";

export function mergeQueueOf(node: JsonRecord): MergeQueueEntry | null {
  const entry = valueAt(node, "mergeQueueEntry");
  if (!isRecord(entry)) return null;
  return {
    state: stringAt(entry, "state") ?? "QUEUED",
    position: numberAt(entry, "position") ?? null,
    enqueuedAt: stringAt(entry, "enqueuedAt") ?? null,
  };
}

export function queueRemovalOf(node: JsonRecord): MergeQueueRemoval | null {
  const [removal] = recordsAt(node, "queueRemovals", "nodes");
  if (!removal) return null;
  return {
    reason: stringAt(removal, "reason") ?? null,
    at: stringAt(removal, "createdAt") ?? null,
  };
}
