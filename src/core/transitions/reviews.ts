import { formatScore } from "../format.ts";
import type { Evaluation, ReviewerEvaluation } from "../types.ts";
import type { DiffContext, Detector } from "./context.ts";
import { describeSha } from "./context.ts";

function reviewKey(reviewer: ReviewerEvaluation | undefined) {
  if (!reviewer || reviewer.score === null) return null;
  return `${reviewer.score}@${reviewer.reviewedSha ?? "?"}#${reviewer.reviewsCount ?? "?"}`;
}

function scoredTransition(reviewer: ReviewerEvaluation, { previous, next, emit }: DiffContext) {
  const key = reviewKey(reviewer);
  const previousReviewer = previous?.reviewers.find(
    (candidate) => candidate.name === reviewer.name,
  );
  if (key === null || key === reviewKey(previousReviewer)) return [];
  const offHead = `on ${describeSha(reviewer.reviewedSha)}, not head ${describeSha(next.headSha)}`;
  const where = reviewer.onHead ? "on head" : offHead;
  return [
    emit("review_scored", `${reviewer.name} scored ${formatScore(reviewer)} ${where}`, {
      bot: reviewer.name,
      score: reviewer.score,
      maxScore: reviewer.maxScore,
      minScore: reviewer.minScore,
      head: reviewer.reviewedSha,
      onHead: reviewer.onHead,
      meetsThreshold: reviewer.meetsThreshold,
      reviewsCount: reviewer.reviewsCount,
    }),
  ];
}

export const detectReviewScored: Detector = (context) =>
  context.next.reviewers.flatMap((reviewer) => scoredTransition(reviewer, context));

export const detectThreadsOpen: Detector = ({ previous, next, emit }) => {
  const previousCount = previous?.threadsOpen ?? 0;
  if (next.threadsOpen === previousCount) return [];
  const reason =
    next.threadsOpen > 0
      ? `${next.threadsOpen} unresolved review thread(s)`
      : "all review threads resolved";
  return [emit("threads_open", reason, { count: next.threadsOpen, previous: previousCount })];
};

export const detectApprovedOnHead: Detector = ({ sameHeadPrevious, next, emit }) => {
  const approvers = next.approvals.onHead;
  const wasApprovedOnHead = (sameHeadPrevious?.approvals.onHead.length ?? 0) > 0;
  if (approvers.length === 0 || wasApprovedOnHead) return [];
  const reason = `approved on ${describeSha(next.headSha)} by ${approvers.join(", ")}`;
  return [emit("approved_on_head", reason, { by: approvers })];
};

const hasOnlyStaleApprovals = (evaluation: Evaluation) =>
  evaluation.approvals.onHead.length === 0 && evaluation.approvals.stale.length > 0;

export const detectApprovalStale: Detector = ({ sameHeadPrevious, next, emit }) => {
  const wasStale = sameHeadPrevious !== null && hasOnlyStaleApprovals(sameHeadPrevious);
  if (!hasOnlyStaleApprovals(next) || wasStale) return [];
  const approvers = next.approvals.stale;
  const reason = `approval by ${approvers.join(", ")} predates head ${describeSha(next.headSha)}`;
  return [emit("approval_stale", reason, { by: approvers })];
};
