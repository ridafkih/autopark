import type { Config } from "../config/schema.ts";
import { formatPullRequest, shortSha } from "./format.ts";
import { fillTemplate } from "./template.ts";
import type { Evaluation, ReasonCode, Transition } from "./types.ts";

export type ReviewRequestTiming = Config["reviewRequest"]["when"];

export interface ReviewRequest {
  head: string | null;
  ready: boolean | null;
}

export interface ReviewStep {
  text: string;
  instruction: string | null;
  isRequested: boolean;
}

export const APPROVAL_CODES: ReadonlySet<string> = new Set<ReasonCode>([
  "approval_missing",
  "approval_stale",
]);

export const EARLY_REQUEST =
  "the earlier request was made before the PR was reviewable; ask again now";

export const needsApproval = (evaluation: Evaluation) =>
  evaluation.state === "OPEN" &&
  !evaluation.isDraft &&
  evaluation.reasons.some((reason) => APPROVAL_CODES.has(reason.code));

const NOT_REVIEWABLE: ReadonlySet<string> = new Set<ReasonCode>([
  "draft",
  "conflict",
  "review_missing",
  "review_stale",
  "review_below_threshold",
  "threads_open",
  "changes_requested",
]);

export const isReviewableForRequest = (isOpen: boolean, reasons: Evaluation["reasons"]) =>
  isOpen && !reasons.some((reason) => NOT_REVIEWABLE.has(reason.code));

const isReviewable = (evaluation: Evaluation) =>
  evaluation.state === "OPEN" && evaluation.awaitingHuman;

export const isEarlyRequest = (request: ReviewRequest, when: ReviewRequestTiming) =>
  when === "ready" && request.head !== null && request.ready !== true;

const isRequestStanding = (
  evaluation: Evaluation,
  request: ReviewRequest,
  when: ReviewRequestTiming,
) => request.head !== null && !(isEarlyRequest(request, when) && isReviewable(evaluation));

export const canAskForApproval = (
  evaluation: Evaluation,
  request: ReviewRequest,
  when: ReviewRequestTiming,
) => !isRequestStanding(evaluation, request, when) && (when === "open" || isReviewable(evaluation));

export const isApprovalRequestDue = (
  evaluation: Evaluation,
  request: ReviewRequest,
  when: ReviewRequestTiming,
) => needsApproval(evaluation) && canAskForApproval(evaluation, request, when);

export function approvalRequestStatus(
  request: ReviewRequest,
  when: ReviewRequestTiming,
  reasons: Evaluation["reasons"],
) {
  if (request.head === null) {
    const isNeeded = reasons.some((reason) => APPROVAL_CODES.has(reason.code));
    return isNeeded ? "approval not requested" : null;
  }
  const requested = `approval requested at ${shortSha(request.head)}`;
  if (!isEarlyRequest(request, when)) return requested;
  return `${requested}: requested early (draft/not reviewable); will re-ask when reviewable`;
}

const templateVariables = (evaluation: Evaluation) => ({
  url: evaluation.url,
  number: String(evaluation.number),
  repo: evaluation.repo,
  title: evaluation.title,
  head: evaluation.headSha,
});

export function reviewStep(
  evaluation: Evaluation,
  { command, instruction }: Config["reviewRequest"],
): ReviewStep {
  const record = `\`autopark request-review ${formatPullRequest(evaluation)}\``;
  if (instruction) {
    const filled = fillTemplate(instruction, templateVariables(evaluation));
    const text = `request approval once: ${filled} Then run ${record} to record it`;
    return { text, instruction: filled, isRequested: true };
  }
  const text = command
    ? `request approval once: run ${record}`
    : "ask the user who reviews, then request review";
  return { text, instruction: null, isRequested: command !== null };
}

function approvalReason(step: ReviewStep, when: ReviewRequestTiming, isEarly: boolean) {
  if (isEarly) return `needs a human approval and ${EARLY_REQUEST}, once: ${step.text}.`;
  if (when === "ready") {
    return `is reviewable and needs a human approval that has not been requested; ask now, and only once for this PR: ${step.text}.`;
  }
  return `needs a human approval and none has been requested; ask now without waiting for checks, and only once for this PR: ${step.text}.`;
}

export function approvalNeededTransition(
  evaluation: Evaluation,
  config: Config,
  request: ReviewRequest,
): Transition {
  const step = reviewStep(evaluation, config.reviewRequest);
  const isEarly = isEarlyRequest(request, config.reviewRequest.when);
  return {
    kind: "approval_needed",
    repo: evaluation.repo,
    number: evaluation.number,
    head: evaluation.headSha || null,
    reason: approvalReason(step, config.reviewRequest.when, isEarly),
    data: {
      reasons: evaluation.reasons.filter((entry) => APPROVAL_CODES.has(entry.code)),
      reRequestReview: step.isRequested,
      instruction: step.instruction,
      next: step.text,
      ...(isEarly ? { requestedEarly: true } : {}),
    },
  };
}
