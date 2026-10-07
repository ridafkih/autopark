import type { Evaluation } from "../core/types.ts";

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

export interface PullRequestRow {
  key: string;
  repo: string;
  number: number;
  tracked: number;
  source: "explicit" | "filter";
  session_id: string | null;
  auto_merge: number | null;
  review_requested_head: string | null;
  merge_attempt_head: string | null;
  evaluation: string | null;
  updated_at: number;
}

export interface TransitionRow {
  id: number;
  at: number;
  json: string;
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

export const toRecord = (row: PullRequestRow): PullRequestRecord => ({
  key: row.key,
  repo: row.repo,
  number: row.number,
  tracked: Boolean(row.tracked),
  source: row.source,
  sessionId: row.session_id,
  autoMerge: row.auto_merge === null ? null : Boolean(row.auto_merge),
  reviewRequestedHead: row.review_requested_head,
  mergeAttemptHead: row.merge_attempt_head,
  evaluation: row.evaluation ? (JSON.parse(row.evaluation) as Evaluation) : null,
  updatedAt: row.updated_at,
});
