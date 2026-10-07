import { formatPullRequest, listOrNone, shortSha } from "../../core/format.ts";
import type { Evaluation, FailedCheck, ReviewerEvaluation } from "../../core/types.ts";

const DISPLAY_SHA_LENGTH = 10;

export interface CheckCost {
  cost: number | null;
  reads: number;
}

const displaySha = (sha: string) => shortSha(sha, DISPLAY_SHA_LENGTH);

function formatHead(evaluation: Evaluation, { cost, reads }: CheckCost) {
  const mergeable = `${evaluation.mergeable}/${evaluation.mergeStateStatus}`;
  const graphqlCost = `${cost ?? "?"} x ${reads} read(s)`;
  const head = displaySha(evaluation.headSha);
  return `head ${head}  state ${evaluation.state}  mergeable ${mergeable}  graphql cost ${graphqlCost}`;
}

const formatReadiness = (evaluation: Evaluation) =>
  `ready ${evaluation.ready}  mergeable now ${evaluation.mergeableNow}  awaiting human ${evaluation.awaitingHuman}`;

function formatBase({ baseRef, base }: Evaluation) {
  const shaSuffix = base.sha ? ` @ ${displaySha(base.sha)}` : "";
  const behindSuffix = base.behindBy === null ? "" : ` (behind ${base.behindBy})`;
  return `base ${baseRef}${shaSuffix}  freshness ${base.policy}${behindSuffix}`;
}

const formatFailure = (check: FailedCheck) => {
  const marker = check.required ? "*" : "";
  return `${check.name}${marker}=${check.conclusion}`;
};

function formatChecks({ checks }: Evaluation) {
  const failed = listOrNone(checks.failed.map(formatFailure));
  const pending = listOrNone(checks.pendingRequired);
  const gates = listOrNone(checks.gates.map((gate) => `${gate.name}=${gate.conclusion}`));
  return `checks: failed ${failed}; pending required ${pending}; gates ${gates}`;
}

function formatReviewer(reviewer: ReviewerEvaluation) {
  const score = reviewer.score ?? "-";
  const scoreText = reviewer.maxScore ? `${score}/${reviewer.maxScore}` : `${score}`;
  const reviewed = reviewer.reviewedSha === null ? "-" : displaySha(reviewer.reviewedSha);
  const detail = `on head ${reviewer.onHead}, reviews ${reviewer.reviewsCount ?? "-"}`;
  return `reviewer ${reviewer.name}: score ${scoreText} on ${reviewed} (${detail})`;
}

function formatThreads({ threadsOpen, approvals }: Evaluation) {
  const onHead = listOrNone(approvals.onHead);
  const stale = listOrNone(approvals.stale);
  return `threads open ${threadsOpen}; approvals on head ${onHead}; stale ${stale}`;
}

export function formatCheckReport(evaluation: Evaluation, cost: CheckCost) {
  return [
    `${formatPullRequest(evaluation)} ${evaluation.title}`,
    formatHead(evaluation, cost),
    formatReadiness(evaluation),
    formatBase(evaluation),
    formatChecks(evaluation),
    ...evaluation.reviewers.map(formatReviewer),
    formatThreads(evaluation),
    ...evaluation.reasons.map((reason) => `  - ${reason.code}: ${reason.detail}`),
  ].join("\n");
}
