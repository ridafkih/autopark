import { approvalNeededTransition, isApprovalRequestDue } from "../core/approval-request.ts";
import type { Evaluation } from "../core/types.ts";
import type { RepoEntry } from "./config-set.ts";
import type { TransitionEmitter } from "./emitter.ts";
import type { Store } from "./store.ts";

export interface ApprovalAskerDependencies {
  store: Store;
  emitter: TransitionEmitter;
}

export async function requestApprovalOnce(
  { store, emitter }: ApprovalAskerDependencies,
  key: string,
  evaluation: Evaluation,
  entry: RepoEntry,
) {
  const requestedHead = store.getPullRequest(key)?.reviewRequestedHead ?? null;
  if (!isApprovalRequestDue(evaluation, requestedHead)) return;
  if (store.hasTransition(key, "approval_needed")) return;
  await emitter.emit(approvalNeededTransition(evaluation, entry.config), evaluation, entry);
}
