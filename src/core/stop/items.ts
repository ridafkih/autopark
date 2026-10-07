import type { Config } from "../../config/schema.ts";
import { formatFailedChecks, formatPullRequest, formatScore, shortSha } from "../format.ts";
import type { Evaluation, ReasonCode, ReviewerEvaluation } from "../types.ts";

export interface TrackedView {
  evaluation: Evaluation;
  sessionId: string | null;
  reviewRequestedHead: string | null;
}

export type ActionKind =
  | "conflict"
  | "stale_base"
  | "failed_checks"
  | "review_findings"
  | "review_not_requested";

export interface ActionItem {
  pr: string;
  kind: ActionKind;
  detail: string;
  next: string;
}

type StopConfig = Config["hooks"]["stop"];
type ItemDraft = Omit<ActionItem, "pr">;

interface ItemContext {
  evaluation: Evaluation;
  view: TrackedView;
  config: StopConfig;
  label: string;
}

type ItemBuilder = (context: ItemContext) => ItemDraft | null;

const hasReason = (evaluation: Evaluation, ...codes: ReasonCode[]) =>
  evaluation.reasons.some((reason) => codes.includes(reason.code));

const reasonDetail = (evaluation: Evaluation, code: ReasonCode) =>
  evaluation.reasons
    .filter((reason) => reason.code === code)
    .map((reason) => reason.detail)
    .join("; ");

const isBelowThreshold = (reviewer: ReviewerEvaluation) =>
  reviewer.required && reviewer.onHead && reviewer.score !== null && !reviewer.meetsThreshold;

const conflictItem: ItemBuilder = ({ evaluation, config }) => {
  if (!config.blockOnConflict || evaluation.mergeable !== "CONFLICTING") return null;
  return {
    kind: "conflict",
    detail: `conflicts with ${evaluation.baseRef}`,
    next: `merge ${evaluation.baseRef} into the branch, resolve, push.`,
  };
};

const staleBaseItem: ItemBuilder = ({ evaluation, config }) => {
  if (!config.blockOnStaleBase || !evaluation.base.stale) return null;
  return {
    kind: "stale_base",
    detail: reasonDetail(evaluation, "stale_base"),
    next: `merge ${evaluation.baseRef} in so required checks run against the current base, push.`,
  };
};

const failedChecksItem: ItemBuilder = ({ evaluation, config }) => {
  const failedRequired = evaluation.checks.failed.filter((check) => check.required);
  if (!config.blockOnFailedChecks || failedRequired.length === 0) return null;
  return {
    kind: "failed_checks",
    detail: `required checks failed: ${formatFailedChecks(failedRequired)}`,
    next: "read the failing logs, fix, push.",
  };
};

const reviewFindingsItem: ItemBuilder = ({ evaluation, config }) => {
  if (!config.blockOnReviewFindings) return null;
  const lowScores = evaluation.reviewers
    .filter(isBelowThreshold)
    .map(
      (reviewer) =>
        `${reviewer.name} scored ${formatScore(reviewer)} on head, needs ${reviewer.minScore}`,
    );
  const hasOpenThreads = evaluation.threadsOpen > 0 && hasReason(evaluation, "threads_open");
  const threads = hasOpenThreads ? [`${evaluation.threadsOpen} unresolved review thread(s)`] : [];
  const findings = [...lowScores, ...threads];
  if (findings.length === 0) return null;
  return {
    kind: "review_findings",
    detail: findings.join("; "),
    next: "address the findings, reply to and resolve each thread, push.",
  };
};

const reviewNotRequestedItem: ItemBuilder = ({ evaluation, view, config, label }) => {
  if (!config.blockOnHeadMovedWithoutReview) return null;
  const needsApproval = hasReason(evaluation, "approval_missing", "approval_stale");
  const requestedHead = view.reviewRequestedHead;
  const isRequestedOnHead = requestedHead === evaluation.headSha;
  const isDue = requestedHead !== null || evaluation.awaitingHuman;
  if (!needsApproval || isRequestedOnHead || !isDue) return null;
  return {
    kind: "review_not_requested",
    detail: `head ${shortSha(evaluation.headSha)} has no review request`,
    next: `request review (autopark request-review ${label}).`,
  };
};

const ITEM_BUILDERS: ItemBuilder[] = [
  conflictItem,
  staleBaseItem,
  failedChecksItem,
  reviewFindingsItem,
  reviewNotRequestedItem,
];

const isPresent = (draft: ItemDraft | null): draft is ItemDraft => draft !== null;

export function actionItemsFor(view: TrackedView, config: StopConfig): ActionItem[] {
  const { evaluation } = view;
  if (evaluation.state !== "OPEN") return [];
  const label = formatPullRequest(evaluation);
  const context: ItemContext = { evaluation, view, config, label };
  return ITEM_BUILDERS.map((build) => build(context))
    .filter(isPresent)
    .map((draft) => ({ pr: label, kind: draft.kind, detail: draft.detail, next: draft.next }));
}
