import type { PullRequestRecord } from "../daemon/store.ts";
import { formatPullRequest, pullRequestUrl } from "./format.ts";
import type { Evaluation, Reason } from "./types.ts";

export interface PullRequestSummary {
  pr: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  head: string | null;
  state: string;
  ready: boolean;
  mergeableNow: boolean;
  awaitingHuman: boolean;
  reasons: Reason[];
  autoMerge: boolean | null;
  sessionId: string | null;
  reviewRequestedHead: string | null;
  updatedAt: number;
}

export function stateLabel(evaluation: Evaluation) {
  if (evaluation.state !== "OPEN") return evaluation.state.toLowerCase();
  if (evaluation.ready) return "ready";
  return evaluation.awaitingHuman ? "awaiting_human" : "not_ready";
}

function evaluationSummary(record: PullRequestRecord) {
  const { evaluation } = record;
  if (!evaluation) {
    return {
      title: "",
      url: pullRequestUrl(record),
      head: null,
      state: "pending",
      ready: false,
      mergeableNow: false,
      awaitingHuman: false,
      reasons: [],
    };
  }
  return {
    title: evaluation.title,
    url: evaluation.url,
    head: evaluation.headSha,
    state: stateLabel(evaluation),
    ready: evaluation.ready,
    mergeableNow: evaluation.mergeableNow,
    awaitingHuman: evaluation.awaitingHuman,
    reasons: evaluation.reasons,
  };
}

export function summarize(record: PullRequestRecord): PullRequestSummary {
  return {
    pr: formatPullRequest(record),
    repo: record.repo,
    number: record.number,
    ...evaluationSummary(record),
    autoMerge: record.autoMerge,
    sessionId: record.sessionId,
    reviewRequestedHead: record.reviewRequestedHead,
    updatedAt: record.updatedAt,
  };
}

function summaryLines(summary: PullRequestSummary) {
  const flags = [summary.mergeableNow ? "mergeable now" : "", summary.autoMerge ? "auto-merge" : ""]
    .filter((flag) => flag !== "")
    .join(", ");
  const flagSuffix = flags ? ` (${flags})` : "";
  const heading = `${summary.pr} [${summary.state}]${flagSuffix} ${summary.title}`;
  const reasons = summary.reasons.map((reason) => `  - ${reason.code}: ${reason.detail}`);
  return [heading.trimEnd(), ...reasons];
}

export function formatSummaries(summaries: PullRequestSummary[], daemonLine = "") {
  const header = daemonLine ? [daemonLine] : [];
  const empty = summaries.length === 0 ? ["No tracked PRs."] : [];
  return [...header, ...empty, ...summaries.flatMap(summaryLines)].join("\n");
}
