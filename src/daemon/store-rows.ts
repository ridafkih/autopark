import type { Hold } from "../core/hold.ts";
import {
  isNullableNumber,
  isNullableString,
  isNumber,
  isRecord,
  isString,
  memberOf,
  numberAt,
  parseJson,
  stringAt,
  valueAt,
} from "../core/json.ts";
import type { NudgeState } from "../core/nudge.ts";
import type { Evaluation } from "../core/types.ts";
import { isEvaluation } from "./evaluation-guard.ts";

export interface PullRequestRecord {
  key: string;
  repo: string;
  number: number;
  tracked: boolean;
  source: "explicit" | "filter";
  sessionId: string | null;
  autoMerge: boolean | null;
  reviewRequestedHead: string | null;
  mergeAttemptHead: string | null;
  evaluation: Evaluation | null;
  nudge: NudgeState | null;
  updatedAt: number;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, event TEXT NOT NULL, received_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS deliveries_received ON deliveries(received_at);
CREATE TABLE IF NOT EXISTS prs (
  key TEXT PRIMARY KEY, repo TEXT NOT NULL, number INTEGER NOT NULL, tracked INTEGER NOT NULL,
  source TEXT NOT NULL, session_id TEXT, auto_merge INTEGER, review_requested_head TEXT,
  merge_attempt_head TEXT, evaluation TEXT, updated_at INTEGER NOT NULL, nudge TEXT
);
CREATE TABLE IF NOT EXISTS holds (target TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transitions (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export const toSqlBoolean = (value: boolean | null) => {
  if (value === null) return null;
  return value ? 1 : 0;
};

const isTrackSource = memberOf(["explicit", "filter"] as const);

const fromSqlBoolean = (value: unknown) =>
  value === null || value === undefined ? null : Boolean(value);

function parseEvaluation(text: string | undefined) {
  if (!text) return null;
  const value = parseJson(text);
  return isEvaluation(value) ? value : null;
}

const isNudgeState = (value: unknown): value is NudgeState =>
  isRecord(value) &&
  isString(value.signature) &&
  isNumber(value.since) &&
  isNumber(value.count) &&
  isNullableNumber(value.headMovedAt) &&
  isNullableNumber(value.lastNudgeAt) &&
  isNullableString(value.next);

function parseNudge(text: string | undefined) {
  if (!text) return null;
  const value = parseJson(text);
  return isNudgeState(value) ? value : null;
}

export function toHold(row: unknown): Hold {
  const target = stringAt(row, "target");
  const until = numberAt(row, "until");
  const createdAt = numberAt(row, "created_at");
  if (target === undefined || until === undefined || createdAt === undefined) {
    throw new Error("malformed holds row");
  }
  return { target, until, reason: stringAt(row, "reason") ?? null, createdAt };
}

function rowIdentity(row: unknown) {
  const key = stringAt(row, "key");
  const repo = stringAt(row, "repo");
  const number = numberAt(row, "number");
  const source = valueAt(row, "source");
  if (key === undefined || repo === undefined || number === undefined || !isTrackSource(source)) {
    throw new Error("malformed prs row");
  }
  return { key, repo, number, source };
}

export function toRecord(row: unknown): PullRequestRecord {
  const { key, repo, number, source } = rowIdentity(row);
  return {
    key,
    repo,
    number,
    tracked: Boolean(valueAt(row, "tracked")),
    source,
    sessionId: stringAt(row, "session_id") ?? null,
    autoMerge: fromSqlBoolean(valueAt(row, "auto_merge")),
    reviewRequestedHead: stringAt(row, "review_requested_head") ?? null,
    mergeAttemptHead: stringAt(row, "merge_attempt_head") ?? null,
    evaluation: parseEvaluation(stringAt(row, "evaluation")),
    nudge: parseNudge(stringAt(row, "nudge")),
    updatedAt: numberAt(row, "updated_at") ?? 0,
  };
}
