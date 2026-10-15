import type { PullRequestRecord } from "../daemon/store.ts";
import type { GitHubPause } from "../github/gate.ts";
import { formatClockTime, formatDuration, formatRemaining } from "./duration.ts";
import { formatPullRequest, pullRequestUrl } from "./format.ts";
import { activeHold, type Hold, type HoldView } from "./hold.ts";
import { stalenessOf, type RecomputeFailure, type Staleness } from "./staleness.ts";
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
  blockedSince: number | null;
  nudges: number;
  nextNudgeAt: number | null;
  hold: HoldView | null;
  stale?: Staleness | null;
  failure?: RecomputeFailure | null;
}

export interface SummaryContext {
  now: number;
  holds: Hold[];
  nextNudgeAt?: number | null;
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

const blockedSince = ({ evaluation, nudge }: PullRequestRecord) =>
  evaluation && !evaluation.ready && nudge ? nudge.since : null;

export function summarize(record: PullRequestRecord, context: SummaryContext): PullRequestSummary {
  return {
    pr: formatPullRequest(record),
    repo: record.repo,
    number: record.number,
    ...evaluationSummary(record),
    autoMerge: record.autoMerge,
    sessionId: record.sessionId,
    reviewRequestedHead: record.reviewRequestedHead,
    updatedAt: record.updatedAt,
    blockedSince: blockedSince(record),
    nudges: record.nudge?.count ?? 0,
    nextNudgeAt: context.nextNudgeAt ?? null,
    hold: activeHold(record.key, context.holds, context.now),
    stale: stalenessOf(record, context.now),
    failure: record.failure,
  };
}

function holdLine(hold: HoldView | null, now: number) {
  if (!hold) return [];
  const scope = hold.scope === "all" ? " (every PR)" : "";
  const why = hold.reason ? `: ${hold.reason}` : "";
  const remaining = formatRemaining(hold.until - now);
  return [`  held ${remaining} more${scope}${why}`];
}

function stuckLine(summary: PullRequestSummary, now: number) {
  if (summary.blockedSince === null) return [];
  const stuck = formatDuration(now - summary.blockedSince);
  const nudged = summary.nudges > 0 ? `, nudged ${summary.nudges}x` : "";
  const next =
    summary.nextNudgeAt === null
      ? ""
      : `, next nudge in ${formatRemaining(summary.nextNudgeAt - now)}`;
  return [`  stuck ${stuck}${nudged}${next}`];
}

const MAX_ERROR_LENGTH = 200;

function staleLines({ stale, failure }: PullRequestSummary, now: number) {
  const staleness = stale ? [`  stale:${stale.kind} ${formatDuration(stale.ageMs)}`] : [];
  if (!failure) return staleness;
  const ago = formatDuration(now - failure.at);
  const message = failure.message.slice(0, MAX_ERROR_LENGTH);
  return [...staleness, `  last error ${ago} ago: ${message}`];
}

export const pauseLine = (pause: GitHubPause) => {
  const until = formatClockTime(pause.until);
  return `GitHub paused until ${until} (${pause.reason})`;
};

function summaryLines(summary: PullRequestSummary, now: number) {
  const flags = [summary.mergeableNow ? "mergeable now" : "", summary.autoMerge ? "auto-merge" : ""]
    .filter((flag) => flag !== "")
    .join(", ");
  const flagSuffix = flags ? ` (${flags})` : "";
  const heading = `${summary.pr} [${summary.state}]${flagSuffix} ${summary.title}`;
  const reasons = summary.reasons.map((reason) => `  - ${reason.code}: ${reason.detail}`);
  return [
    heading.trimEnd(),
    ...holdLine(summary.hold, now),
    ...staleLines(summary, now),
    ...stuckLine(summary, now),
    ...reasons,
  ];
}

export function formatSummaries(
  summaries: PullRequestSummary[],
  daemonLine = "",
  now = 0,
  pause: GitHubPause | null = null,
) {
  const header = [...(daemonLine ? [daemonLine] : []), ...(pause ? [pauseLine(pause)] : [])];
  const emptyNotice = summaries.length === 0 ? ["No tracked PRs."] : [];
  const lines = summaries.flatMap((summary) => summaryLines(summary, now));
  return [...header, ...emptyNotice, ...lines].join("\n");
}
