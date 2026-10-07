import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pullRequestKey, type Evaluation, type Transition } from "../core/types.ts";
import {
  SCHEMA,
  toRecord,
  toSqlBoolean,
  type PullRequestRecord,
  type PullRequestRow,
  type TransitionRow,
} from "./store-rows.ts";

export type { PullRequestRecord } from "./store-rows.ts";

export interface StoredTransition extends Transition {
  id: number;
  at: number;
}

export interface TrackRequest {
  repo: string;
  number: number;
  source: "explicit" | "filter";
  sessionId: string | null;
  now: number;
}

const TRACK_SQL = `INSERT INTO prs (key, repo, number, tracked, source, session_id, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET tracked = 1,
           source = CASE WHEN prs.source = 'explicit' THEN 'explicit' ELSE excluded.source END,
           session_id = COALESCE(excluded.session_id, prs.session_id),
           updated_at = excluded.updated_at`;

function openDatabase(path: string, isReadonly: boolean) {
  if (isReadonly) return new Database(path, { readonly: true });
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true });
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA busy_timeout = 2000");
  database.exec(SCHEMA);
  return database;
}

export class Store {
  readonly db: Database;

  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.db = openDatabase(path, options.readonly === true);
  }

  markDelivery(id: string, event: string, now: number) {
    const insert = "INSERT OR IGNORE INTO deliveries (id, event, received_at) VALUES (?, ?, ?)";
    return this.db.query(insert).run(id, event, now).changes > 0;
  }

  pruneDeliveries(olderThan: number) {
    this.db.query("DELETE FROM deliveries WHERE received_at < ?").run(olderThan);
  }

  track({ repo, number, source, sessionId, now }: TrackRequest) {
    const key = pullRequestKey(repo, number);
    this.db.query(TRACK_SQL).run(key, repo, number, source, sessionId, now);
    return key;
  }

  getPullRequest(key: string): PullRequestRecord | null {
    const row = this.db.query<PullRequestRow, [string]>("SELECT * FROM prs WHERE key = ?").get(key);
    return row ? toRecord(row) : null;
  }

  listPullRequests({ trackedOnly }: { trackedOnly: boolean }): PullRequestRecord[] {
    const sql = trackedOnly
      ? "SELECT * FROM prs WHERE tracked = 1 ORDER BY key"
      : "SELECT * FROM prs ORDER BY key";
    return this.db.query<PullRequestRow, []>(sql).all().map(toRecord);
  }

  setTracked(key: string, isTracked: boolean) {
    this.db.query("UPDATE prs SET tracked = ? WHERE key = ?").run(toSqlBoolean(isTracked), key);
  }

  setAutoMerge(key: string, enabled: boolean | null) {
    this.db.query("UPDATE prs SET auto_merge = ? WHERE key = ?").run(toSqlBoolean(enabled), key);
  }

  setReviewRequested(key: string, head: string | null) {
    this.db.query("UPDATE prs SET review_requested_head = ? WHERE key = ?").run(head, key);
  }

  setMergeAttempt(key: string, head: string | null) {
    this.db.query("UPDATE prs SET merge_attempt_head = ? WHERE key = ?").run(head, key);
  }

  saveEvaluation(key: string, evaluation: Evaluation, now: number) {
    this.db
      .query("UPDATE prs SET evaluation = ?, updated_at = ? WHERE key = ?")
      .run(JSON.stringify(evaluation), now, key);
  }

  appendTransition(transition: Transition, now: number): number {
    const insert = "INSERT INTO transitions (at, key, kind, json) VALUES (?, ?, ?, ?) RETURNING id";
    const key = pullRequestKey(transition.repo, transition.number);
    const row = this.db
      .query<{ id: number }, [number, string, string, string]>(insert)
      .get(now, key, transition.kind, JSON.stringify(transition));
    if (!row) throw new Error("transition insert returned no id");
    return row.id;
  }

  transitionsSince(id: number, limit = 500): StoredTransition[] {
    const select = "SELECT id, at, json FROM transitions WHERE id > ? ORDER BY id LIMIT ?";
    return this.db
      .query<TransitionRow, [number, number]>(select)
      .all(id, limit)
      .map((row) => Object.assign(JSON.parse(row.json) as Transition, { id: row.id, at: row.at }));
  }

  getMeta(key: string): string | null {
    const row = this.db.query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(key);
    return row?.v ?? null;
  }

  setMeta(key: string, value: string) {
    this.db
      .query("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
      .run(key, value);
  }

  close() {
    this.db.close();
  }
}
