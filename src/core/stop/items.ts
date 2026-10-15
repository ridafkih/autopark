import type { Config } from "../../config/schema.ts";
import { isApprovalRequestDue } from "../approval-request.ts";
import { formatPullRequest, formatScore } from "../format.ts";
import type { HoldView } from "../hold.ts";
import { formatDuration } from "../duration.ts";
import { nudgeKindsOf, type NudgeState } from "../nudge.ts";
import type { Staleness } from "../staleness.ts";
import {
  pullRequestKey,
  type Evaluation,
  type ReasonCode,
  type ReviewerEvaluation,
} from "../types.ts";

export interface TrackedView {
  evaluation: Evaluation;
  sessionId: string | null;
  reviewRequestedHead: string | null;
  nudge?: NudgeState | null;
  hold?: HoldView | null;
  stale?: Staleness | null;
}

export type ActionKind =
  | "conflict"
  | "failed_checks"
  | "review_findings"
  | "review_not_requested"
  | "nudged"
  | "stale";

export interface ActionItem {
  repo: string;
  number: number;
  kind: ActionKind;
  codes: string[];
  fingerprint?: string[];
}

type StopConfig = Config["hooks"]["stop"];
type ItemDraft = Pick<ActionItem, "kind" | "codes" | "fingerprint">;

interface ItemContext {
  evaluation: Evaluation;
  view: TrackedView;
  config: StopConfig;
}

type ItemBuilder = (context: ItemContext) => ItemDraft | null;

const hasReason = (evaluation: Evaluation, ...codes: ReasonCode[]) =>
  evaluation.reasons.some((reason) => codes.includes(reason.code));

const isBelowThreshold = (reviewer: ReviewerEvaluation) =>
  reviewer.required && reviewer.onHead && reviewer.score !== null && !reviewer.meetsThreshold;

const conflictItem: ItemBuilder = ({ evaluation, config }) => {
  if (!config.blockOnConflict || evaluation.mergeable !== "CONFLICTING") return null;
  return { kind: "conflict", codes: ["conflict"] };
};

const failedChecksItem: ItemBuilder = ({ evaluation, config }) => {
  const failedRequired = evaluation.checks.failed.filter((check) => check.required);
  if (!config.blockOnFailedChecks || failedRequired.length === 0) return null;
  const names = failedRequired.map((check) => check.name).join("+");
  return { kind: "failed_checks", codes: [`checks:${names}`] };
};

const reviewFindingsItem: ItemBuilder = ({ evaluation, config }) => {
  if (!config.blockOnReviewFindings) return null;
  const hasOpenThreads = evaluation.threadsOpen > 0 && hasReason(evaluation, "threads_open");
  const threads = hasOpenThreads ? [`threads:${evaluation.threadsOpen}`] : [];
  const lowScores = evaluation.reviewers
    .filter(isBelowThreshold)
    .map((reviewer) => `${reviewer.name}:${formatScore(reviewer)}`);
  const codes = [...threads, ...lowScores];
  return codes.length > 0 ? { kind: "review_findings", codes } : null;
};

const reviewNotRequestedItem: ItemBuilder = ({ evaluation, view, config }) => {
  const isEarly = config.blockOnHeadMovedWithoutReview || evaluation.awaitingHuman;
  if (!isEarly || !isApprovalRequestDue(evaluation, view.reviewRequestedHead)) return null;
  return { kind: "review_not_requested", codes: ["approval_needed"] };
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
  const kinds = nudgeKindsOf(evaluation).join("+");
  return [{ kind: "nudged", codes: [`nudged:${kinds || "ready"}`] }];
}

function staleItem({ stale }: TrackedView): ItemDraft[] {
  if (!stale) return [];
  const code = `stale:${stale.kind}`;
  const age = formatDuration(stale.ageMs);
  return [{ kind: "stale", codes: [`${code} ${age}`], fingerprint: [code, String(stale.since)] }];
}

export function actionItemsFor(view: TrackedView, config: StopConfig): ActionItem[] {
  const { evaluation } = view;
  if (evaluation.state !== "OPEN") return [];
  const context: ItemContext = { evaluation, view, config };
  const drafts = ITEM_BUILDERS.map((build) => build(context)).filter(isPresent);
  const items = drafts.length > 0 ? drafts : nudgedItem(context);
  const locator = { repo: evaluation.repo, number: evaluation.number };
  return [...items, ...staleItem(view)].map((draft): ActionItem =>
    Object.assign({}, locator, draft),
  );
}

export function actionLines(items: ActionItem[]): string[] {
  const isOneRepo = new Set(items.map((item) => item.repo.toLowerCase())).size <= 1;
  const lines = new Map<string, { label: string; codes: string[] }>();
  for (const item of items) {
    const key = pullRequestKey(item.repo, item.number);
    const label = isOneRepo ? `#${item.number}` : formatPullRequest(item);
    const line = lines.get(key) ?? { label, codes: [] };
    line.codes.push(...item.codes);
    lines.set(key, line);
  }
  return [...lines.values()].map(({ label, codes }) => `${label} ${codes.join(", ")}`);
}
