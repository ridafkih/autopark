import {
  hasBooleans,
  hasStrings,
  isArrayOf,
  isBoolean,
  isNullableNumber,
  isNullableString,
  isNumber,
  memberOf,
  isRecord,
  isString,
} from "./json.ts";
import type { PullRequestSummary } from "./summary.ts";
import { REASON_CODES, type Reason } from "./types.ts";

const isReasonCode = memberOf(REASON_CODES);

export const isReason = (value: unknown): value is Reason =>
  isRecord(value) && isReasonCode(value.code) && isString(value.detail);

const isHoldScope = memberOf(["pr", "all"] as const);

const isHoldView = (value: unknown) =>
  value === null ||
  (isRecord(value) &&
    isNumber(value.until) &&
    isNullableString(value.reason) &&
    isHoldScope(value.scope));

const isNullableBoolean = (value: unknown): value is boolean | null =>
  value === null || isBoolean(value);

const hasNudgeFields = (value: Record<string, unknown>) =>
  isNumber(value.nudges) &&
  [value.blockedSince, value.nextNudgeAt].every(isNullableNumber) &&
  isHoldView(value.hold);

export const isPullRequestSummary = (value: unknown): value is PullRequestSummary =>
  isRecord(value) &&
  hasStrings(value, ["pr", "repo", "title", "url", "state"]) &&
  hasBooleans(value, ["ready", "mergeableNow", "awaitingHuman"]) &&
  [value.number, value.updatedAt].every(isNumber) &&
  isNullableBoolean(value.autoMerge) &&
  [value.head, value.sessionId, value.reviewRequestedHead].every(isNullableString) &&
  isArrayOf(value.reasons, isReason) &&
  hasNudgeFields(value);
