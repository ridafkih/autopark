import type { Database } from "bun:sqlite";
import { stringAt } from "../core/json.ts";

export const TRACK_SQL = `INSERT INTO prs (key, repo, number, tracked, source, session_id, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET tracked = 1,
           source = CASE WHEN prs.source = 'explicit' THEN 'explicit' ELSE excluded.source END,
           session_id = COALESCE(excluded.session_id, prs.session_id),
           updated_at = excluded.updated_at`;

export const UPSERT_HOLD = `INSERT INTO holds (target, until, reason, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(target) DO UPDATE SET until = excluded.until, reason = excluded.reason,
           created_at = excluded.created_at`;

export const MARK_EVENT_SQL = `UPDATE prs SET event_at = ?1, stale_since = COALESCE(stale_since, ?1)
         WHERE key = ?2`;

export const SAVE_EVALUATION_SQL = `UPDATE prs SET evaluation = ?1, updated_at = ?2, evaluated_at = ?3,
           failure = NULL,
           stale_since = CASE WHEN event_at > ?3 THEN event_at ELSE NULL END
         WHERE key = ?4`;

export const SET_REVIEW_REQUESTED_SQL = `UPDATE prs SET review_requested_head = ?, review_requested_ready = ?
         WHERE key = ?`;

export const FLAGGED_TRANSITION_SQL = `SELECT 1 FROM transitions
         WHERE key = ? AND kind = ? AND json_extract(json, ?) = 1 LIMIT 1`;

export const RECORD_FAILURE_SQL = `UPDATE prs SET failure = ?1, stale_since = COALESCE(stale_since, ?2)
         WHERE key = ?3`;

const ADDED_COLUMNS = [
  ["nudge", "TEXT"],
  ["event_at", "INTEGER"],
  ["evaluated_at", "INTEGER"],
  ["stale_since", "INTEGER"],
  ["failure", "TEXT"],
  ["review_requested_ready", "INTEGER"],
] as const;

export function addMissingColumns(database: Database) {
  const columns = new Set(
    database
      .query("PRAGMA table_info(prs)")
      .all()
      .map((row) => stringAt(row, "name")),
  );
  for (const [name, type] of ADDED_COLUMNS) {
    if (!columns.has(name)) database.run(`ALTER TABLE prs ADD COLUMN ${name} ${type}`);
  }
}
