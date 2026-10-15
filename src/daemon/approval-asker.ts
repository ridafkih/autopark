import { approvalNeededTransition, isApprovalRequestDue } from "../core/approval-request.ts";
import type { Evaluation } from "../core/types.ts";
import type { RepoEntry } from "./config-set.ts";
import type { TransitionEmitter } from "./emitter.ts";
import { reviewRequestOf, type Store } from "./store.ts";

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
  const request = reviewRequestOf(store.getPullRequest(key));
  if (!isApprovalRequestDue(evaluation, request, entry.config.reviewRequest.when)) return;
  const flag = request.head === null ? null : "requestedEarly";
  if (store.hasTransition(key, "approval_needed", flag)) return;
  const transition = approvalNeededTransition(evaluation, entry.config, request);
  await emitter.emit(transition, evaluation, entry);
}
