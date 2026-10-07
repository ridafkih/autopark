import {
  hasBooleans,
  hasStrings,
  isArrayOf,
  isNullableNumber,
  isNullableString,
  isNumber,
  memberOf,
  isRecord,
  isString,
  isStringArray,
} from "../core/json.ts";
import {
  CHECK_OUTCOMES,
  MERGEABLE_STATES,
  PULL_REQUEST_STATES,
  type Evaluation,
  type FailedCheck,
  type ReviewerEvaluation,
} from "../core/types.ts";
import { isReason } from "../core/guards.ts";

type Gate = Evaluation["checks"]["gates"][number];

const isMergeable = memberOf(MERGEABLE_STATES);
const isPullRequestState = memberOf(PULL_REQUEST_STATES);
const isGateOutcome = memberOf([...CHECK_OUTCOMES, "missing"] as const);

const isFailedCheck = (value: unknown): value is FailedCheck =>
  isRecord(value) &&
  hasStrings(value, ["name", "conclusion"]) &&
  hasBooleans(value, ["required"]) &&
  isNullableString(value.url);

const isGate = (value: unknown): value is Gate =>
  isRecord(value) && hasStrings(value, ["name", "conclusion"]) && isGateOutcome(value.outcome);

const isReviewerEvaluation = (value: unknown): value is ReviewerEvaluation =>
  isRecord(value) &&
  isString(value.name) &&
  hasBooleans(value, ["present", "onHead", "required", "meetsThreshold"]) &&
  [value.score, value.maxScore, value.reviewsCount, value.minScore].every(isNullableNumber) &&
  [value.reviewedSha, value.commentId].every(isNullableString);

const isBase = (value: unknown): value is Evaluation["base"] =>
  isRecord(value) &&
  isNullableString(value.sha) &&
  isNullableNumber(value.behindBy) &&
  isStringArray(value.touched) &&
  hasBooleans(value, ["stale"]) &&
  isString(value.policy);

const isChecks = (value: unknown): value is Evaluation["checks"] =>
  isRecord(value) &&
  isArrayOf(value.failed, isFailedCheck) &&
  isStringArray(value.pendingRequired) &&
  isArrayOf(value.gates, isGate) &&
  hasBooleans(value, ["requiredGreen"]);

const isApprovals = (value: unknown): value is Evaluation["approvals"] =>
  isRecord(value) && [value.onHead, value.stale, value.changesRequested].every(isStringArray);

const IDENTITY_STRINGS = ["repo", "title", "url", "headRef", "baseRef", "headSha"];
const FLAGS = ["isDraft", "ready", "mergeableNow", "awaitingHuman"];

const hasScalars = (value: Record<string, unknown>) =>
  hasStrings(value, [...IDENTITY_STRINGS, "mergeStateStatus"]) &&
  hasBooleans(value, FLAGS) &&
  isNumber(value.number) &&
  isNumber(value.threadsOpen) &&
  isPullRequestState(value.state) &&
  isMergeable(value.mergeable) &&
  isMergeable(value.lastKnownMergeable) &&
  isStringArray(value.labels);

export const isEvaluation = (value: unknown): value is Evaluation =>
  isRecord(value) &&
  hasScalars(value) &&
  isBase(value.base) &&
  isChecks(value.checks) &&
  isArrayOf(value.reviewers, isReviewerEvaluation) &&
  isApprovals(value.approvals) &&
  isArrayOf(value.reasons, isReason);
