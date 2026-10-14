import type { Config } from "../../config/schema.ts";
import { isApprovalRequestDue } from "../approval-request.ts";
import { formatFailedChecks, formatPullRequest, formatScore } from "../format.ts";
import type { HoldView } from "../hold.ts";
import { nudgeKindsOf, type NudgeState } from "../nudge.ts";
import type { Evaluation, ReasonCode, ReviewerEvaluation } from "../types.ts";

export interface TrackedView {
  evaluation: Evaluation;
  sessionId: string | null;
  reviewRequestedHead: string | null;
  nudge?: NudgeState | null;
  hold?: HoldView | null;
}

export type ActionKind =
  | "conflict"
  | "failed_checks"
  | "review_findings"
  | "review_not_requested"
  | "nudged";

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
  const isEarly = config.blockOnHeadMovedWithoutReview || evaluation.awaitingHuman;
  if (!isEarly || !isApprovalRequestDue(evaluation, view.reviewRequestedHead)) return null;
  return {
    kind: "review_not_requested",
    detail: `${label} needs approval and review was never requested`,
    next: `request approval once (autopark request-review ${label}); approvals persist across pushes, so never re-ask.`,
  };
};

const ITEM_BUILDERS: ItemBuilder[] = [
  conflictItem,
  failedChecksItem,
  reviewFindingsItem,
  reviewNotRequestedItem,
];

const isPresent = (draft: ItemDraft | null): draft is ItemDraft => draft !== null;

function nudgedItem({ evaluation, view }: ItemContext): ItemDraft[] {
  const { nudge } = view;
  if (!nudge || nudge.count === 0) return [];
  const kinds = nudgeKindsOf(evaluation).join(", ");
  const situation = kinds ? `stuck on ${kinds}` : "ready but not merged";
  const next = nudge.next ?? "clear what `autopark status` lists as blocking";
  return [{ kind: "nudged", detail: `${situation}, nudged ${nudge.count}x`, next: `${next}.` }];
}

export function actionItemsFor(view: TrackedView, config: StopConfig): ActionItem[] {
  const { evaluation } = view;
  if (evaluation.state !== "OPEN") return [];
  const label = formatPullRequest(evaluation);
  const context: ItemContext = { evaluation, view, config, label };
  const drafts = ITEM_BUILDERS.map((build) => build(context)).filter(isPresent);
  const items = drafts.length > 0 ? drafts : nudgedItem(context);
  return items.map((draft) => ({
    pr: label,
    kind: draft.kind,
    detail: draft.detail,
    next: draft.next,
  }));
}
