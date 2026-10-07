export const TRANSITION_KINDS = [
  "head_moved",
  "conflicted",
  "conflict_resolved",
  "mergeability_unknown",
  "checks_failed",
  "checks_passed",
  "review_scored",
  "threads_open",
  "approved_on_head",
  "approval_stale",
  "awaiting_human",
  "ready",
  "not_ready",
  "merged",
  "closed",
  "merge_attempted",
] as const;

export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type PrState = "OPEN" | "CLOSED" | "MERGED";
export type CheckOutcome = "pass" | "fail" | "pending";

export interface CheckContext {
  name: string;
  kind: "check" | "status";
  outcome: CheckOutcome;
  conclusion: string;
  isRequired: boolean;
  app: string | null;
  url: string | null;
}

export interface Approval {
  login: string;
  state: string;
  sha: string | null;
}

export interface ReviewThread {
  id: string;
  resolved: boolean;
  outdated: boolean;
  author: string | null;
  path: string | null;
  url: string | null;
}

export interface PrComment {
  id: string;
  author: string | null;
  body: string;
  updatedAt: string;
}

export interface Snapshot {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: PrState;
  isDraft: boolean;
  author: string | null;
  headRef: string;
  baseRef: string;
  headSha: string;
  labels: string[];
  mergeable: Mergeable;
  mergeStateStatus: string;
  checks: CheckContext[];
  approvals: Approval[];
  threads: ReviewThread[];
  comments: PrComment[];
}

export interface ReviewerResult {
  score: number | null;
  maxScore: number | null;
  reviewedSha: string | null;
  reviewsCount: number | null;
  commentId: string | null;
}

export interface ReviewerEval extends ReviewerResult {
  name: string;
  present: boolean;
  onHead: boolean;
  required: boolean;
  minScore: number | null;
  meetsThreshold: boolean;
}

export interface FailedCheck {
  name: string;
  conclusion: string;
  required: boolean;
  url: string | null;
}

export type ReasonCode =
  | "closed"
  | "draft"
  | "conflict"
  | "mergeability_unknown"
  | "checks_failed"
  | "checks_pending"
  | "review_missing"
  | "review_stale"
  | "review_below_threshold"
  | "threads_open"
  | "changes_requested"
  | "approval_missing"
  | "approval_stale"
  | "human_gate_pending";

export interface Reason {
  code: ReasonCode;
  detail: string;
}

export interface Evaluation {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: PrState;
  isDraft: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  labels: string[];
  mergeable: Mergeable;
  lastKnownMergeable: Mergeable;
  mergeStateStatus: string;
  checks: {
    failed: FailedCheck[];
    pendingRequired: string[];
    gates: Array<{ name: string; outcome: CheckOutcome | "missing"; conclusion: string }>;
    requiredGreen: boolean;
  };
  reviewers: ReviewerEval[];
  threadsOpen: number;
  approvals: { onHead: string[]; stale: string[]; changesRequested: string[] };
  reasons: Reason[];
  ready: boolean;
  mergeableNow: boolean;
  awaitingHuman: boolean;
}

export interface Transition {
  kind: TransitionKind;
  repo: string;
  number: number;
  head: string | null;
  reason: string;
  data: Record<string, unknown>;
}

export interface LoggedTransition extends Transition {
  id: number;
  ts: string;
  title: string;
  url: string;
}

export const prKey = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`;
