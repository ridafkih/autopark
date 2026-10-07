import { memberOf, numberAt, parseJson, stringAt, valueAt } from "../core/json.ts";
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
  updatedAt: number;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, event TEXT NOT NULL, received_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS deliveries_received ON deliveries(received_at);
CREATE TABLE IF NOT EXISTS prs (
  key TEXT PRIMARY KEY, repo TEXT NOT NULL, number INTEGER NOT NULL, tracked INTEGER NOT NULL,
  source TEXT NOT NULL, session_id TEXT, auto_merge INTEGER, review_requested_head TEXT,
  merge_attempt_head TEXT, evaluation TEXT, updated_at INTEGER NOT NULL
);
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
    updatedAt: numberAt(row, "updated_at") ?? 0,
  };
}
