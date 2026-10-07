import {
  hasBooleans,
  hasStrings,
  isArrayOf,
  isBoolean,
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

const isNullableBoolean = (value: unknown): value is boolean | null =>
  value === null || isBoolean(value);

export const isPullRequestSummary = (value: unknown): value is PullRequestSummary =>
  isRecord(value) &&
  hasStrings(value, ["pr", "repo", "title", "url", "state"]) &&
  hasBooleans(value, ["ready", "mergeableNow", "awaitingHuman"]) &&
  isNumber(value.number) &&
  isNumber(value.updatedAt) &&
  isNullableBoolean(value.autoMerge) &&
  [value.head, value.sessionId, value.reviewRequestedHead].every(isNullableString) &&
  isArrayOf(value.reasons, isReason);
