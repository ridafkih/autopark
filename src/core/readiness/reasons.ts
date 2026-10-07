import type { Config } from "../../config/schema.ts";
import { formatScore, shortSha } from "../format.ts";
import type { Evaluation, Reason, ReasonCode, ReviewerEvaluation, Snapshot } from "../types.ts";
import { staleDetail } from "./base.ts";

type Readiness = Config["readiness"];

export interface ReasonInputs {
  snapshot: Snapshot;
  readiness: Readiness;
  base: Evaluation["base"];
  isBaseUnknown: boolean;
  checks: Evaluation["checks"];
  reviewers: ReviewerEvaluation[];
  threadsOpen: number;
  approvals: Evaluation["approvals"];
}

const reason = (code: ReasonCode, detail: string): Reason => ({ code, detail });
const isReason = (candidate: Reason | null): candidate is Reason => candidate !== null;

function lifecycleReasons({ snapshot, readiness }: ReasonInputs) {
  const closed = reason("closed", `PR is ${snapshot.state.toLowerCase()}`);
  return [
    snapshot.state === "OPEN" ? null : closed,
    snapshot.isDraft && !readiness.allowDraft ? reason("draft", "PR is a draft") : null,
  ];
}

function mergeabilityReason({ snapshot, readiness }: ReasonInputs) {
  if (!readiness.noConflict) return null;
  if (snapshot.mergeable === "CONFLICTING") {
    return reason("conflict", `conflicts with ${snapshot.baseRef}`);
  }
  if (snapshot.mergeable === "UNKNOWN" && snapshot.state === "OPEN") {
    return reason("mergeability_unknown", "GitHub has not computed mergeability yet");
  }
  return null;
}

function baseReason({ snapshot, base, isBaseUnknown }: ReasonInputs) {
  if (base.stale) return reason("stale_base", staleDetail(snapshot.baseRef, base));
  if (isBaseUnknown) {
    return reason("base_unknown", `could not compare head with ${snapshot.baseRef}`);
  }
  return null;
}

function checkReasons({ checks, readiness }: ReasonInputs) {
  if (!readiness.requiredChecksPass) return [];
  const failedRequired = checks.failed.filter((check) => check.required).map((check) => check.name);
  const failed = reason("checks_failed", `required checks failed: ${failedRequired.join(", ")}`);
  const pendingNames = checks.pendingRequired.join(", ");
  const pending = reason("checks_pending", `required checks pending: ${pendingNames}`);
  return [
    failedRequired.length > 0 ? failed : null,
    checks.pendingRequired.length > 0 ? pending : null,
  ];
}

function reviewerReason(reviewer: ReviewerEvaluation, headSha: string) {
  if (!reviewer.required) return null;
  if (!reviewer.present || reviewer.score === null) {
    return reason("review_missing", `${reviewer.name} has not scored this PR`);
  }
  if (!reviewer.onHead) {
    const reviewed =
      reviewer.reviewedSha === null ? "an unknown commit" : shortSha(reviewer.reviewedSha);
    const detail = `${reviewer.name} scored ${reviewed}, not head ${shortSha(headSha)}`;
    return reason("review_stale", detail);
  }
  if (!reviewer.meetsThreshold) {
    const detail = `${reviewer.name} scored ${formatScore(reviewer)}, needs ${reviewer.minScore}`;
    return reason("review_below_threshold", detail);
  }
  return null;
}

function threadReason({ readiness, threadsOpen }: ReasonInputs) {
  if (!readiness.noUnresolvedThreads || threadsOpen === 0) return null;
  return reason("threads_open", `${threadsOpen} unresolved review thread(s)`);
}

function changesRequestedReason({ approvals }: ReasonInputs) {
  if (approvals.changesRequested.length === 0) return null;
  const requesters = approvals.changesRequested.join(", ");
  return reason("changes_requested", `changes requested by ${requesters}`);
}

function approvalReason({ approvals, readiness }: ReasonInputs) {
  const { onHead, stale } = approvals;
  const counted = readiness.approvalOnHead ? onHead.length : onHead.length + stale.length;
  if (counted >= readiness.minApprovals) return null;
  if (readiness.approvalOnHead && stale.length > 0) {
    return reason("approval_stale", `approval by ${stale.join(", ")} is on an older commit`);
  }
  const needed = readiness.minApprovals;
  return reason("approval_missing", `needs ${needed} approval(s) on head, has ${counted}`);
}

export function collectReasons(inputs: ReasonInputs): Reason[] {
  const { reviewers, snapshot } = inputs;
  return [
    ...lifecycleReasons(inputs),
    mergeabilityReason(inputs),
    baseReason(inputs),
    ...checkReasons(inputs),
    ...reviewers.map((reviewer) => reviewerReason(reviewer, snapshot.headSha)),
    threadReason(inputs),
    changesRequestedReason(inputs),
    approvalReason(inputs),
  ].filter(isReason);
}
