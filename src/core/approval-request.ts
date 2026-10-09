import type { Config } from "../config/schema.ts";
import { formatPullRequest } from "./format.ts";
import { fillTemplate } from "./template.ts";
import type { Evaluation, ReasonCode, Transition } from "./types.ts";

export interface ReviewStep {
  text: string;
  instruction: string | null;
  isRequested: boolean;
}

export const APPROVAL_CODES: ReadonlySet<string> = new Set<ReasonCode>([
  "approval_missing",
  "approval_stale",
]);

export const needsApproval = (evaluation: Evaluation) =>
  evaluation.state === "OPEN" &&
  !evaluation.isDraft &&
  evaluation.reasons.some((reason) => APPROVAL_CODES.has(reason.code));

export const isApprovalRequestDue = (evaluation: Evaluation, requestedHead: string | null) =>
  requestedHead === null && needsApproval(evaluation);

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

export function approvalNeededTransition(evaluation: Evaluation, config: Config): Transition {
  const step = reviewStep(evaluation, config.reviewRequest);
  const reason = `needs a human approval and none has been requested; ask now without waiting for checks, and only once for this PR: ${step.text}.`;
  return {
    kind: "approval_needed",
    repo: evaluation.repo,
    number: evaluation.number,
    head: evaluation.headSha || null,
    reason,
    data: {
      reasons: evaluation.reasons.filter((entry) => APPROVAL_CODES.has(entry.code)),
      reRequestReview: step.isRequested,
      instruction: step.instruction,
      next: step.text,
    },
  };
}
