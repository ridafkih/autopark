import { pullRequestUrl } from "./format.ts";
import { isNumber, isRecord, isString, memberOf } from "./json.ts";
import type { Evaluation } from "./types.ts";

export const FAILURE_KINDS = ["rate_limited", "error"] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export type StaleKind = FailureKind | "pending";

export interface RecomputeFailure {
  kind: FailureKind;
  message: string;
  at: number;
}

const isFailureKind = memberOf(FAILURE_KINDS);

export const isRecomputeFailure = (value: unknown): value is RecomputeFailure =>
  isRecord(value) && isFailureKind(value.kind) && isString(value.message) && isNumber(value.at);

export interface Freshness {
  eventAt: number | null;
  evaluatedAt: number | null;
  staleSince: number | null;
  failure: RecomputeFailure | null;
}

export interface Staleness {
  kind: StaleKind;
  since: number;
  ageMs: number;
}

export const PENDING_GRACE_MS = 120_000;

const staleFor = (kind: StaleKind, since: number, now: number): Staleness => ({
  kind,
  since,
  ageMs: Math.max(0, now - since),
});

const hasUnseenEvent = ({ eventAt, evaluatedAt }: Freshness) =>
  eventAt !== null && (evaluatedAt === null || eventAt > evaluatedAt);

export function stalenessOf(freshness: Freshness, now: number): Staleness | null {
  const { failure, staleSince, eventAt } = freshness;
  if (failure) return staleFor(failure.kind, staleSince ?? failure.at, now);
  if (!hasUnseenEvent(freshness)) return null;
  const since = staleSince ?? eventAt ?? now;
  return now - since >= PENDING_GRACE_MS ? staleFor("pending", since, now) : null;
}

export const unevaluated = (repo: string, number: number): Evaluation => ({
  repo,
  number,
  title: "",
  url: pullRequestUrl({ repo, number }),
  state: "OPEN",
  isDraft: false,
  headRef: "",
  baseRef: "",
  headSha: "",
  labels: [],
  mergeable: "UNKNOWN",
  lastKnownMergeable: "UNKNOWN",
  mergeStateStatus: "UNKNOWN",
  checks: { failed: [], pendingRequired: [], gates: [], requiredGreen: false },
  reviewers: [],
  threadsOpen: 0,
  approvals: { onHead: [], stale: [], changesRequested: [] },
  reasons: [],
  ready: false,
  mergeableNow: false,
  awaitingHuman: false,
});
