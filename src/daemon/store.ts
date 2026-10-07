import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { prKey, type Evaluation, type Transition } from "../core/types.ts";

export interface PrRecord {
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

export interface StoredTransition extends Transition {
  id: number;
  at: number;
}

const SCHEMA = `
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

function toRecord(r: any): PrRecord {
  return {
    key: r.key,
    repo: r.repo,
    number: r.number,
    tracked: !!r.tracked,
    source: r.source,
    sessionId: r.session_id,
    autoMerge: r.auto_merge === null ? null : !!r.auto_merge,
    reviewRequestedHead: r.review_requested_head,
    mergeAttemptHead: r.merge_attempt_head,
    evaluation: r.evaluation ? JSON.parse(r.evaluation) : null,
    updatedAt: r.updated_at,
  };
}

export class Store {
  readonly db: Database;

  constructor(path: string, opts: { readonly?: boolean } = {}) {
    if (path !== ":memory:" && !opts.readonly) mkdirSync(dirname(path), { recursive: true });
    this.db = opts.readonly ? new Database(path, { readonly: true }) : new Database(path, { create: true });
    if (!opts.readonly) {
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA busy_timeout = 2000");
      this.db.exec(SCHEMA);
    }
  }

  markDelivery(id: string, event: string, now: number) {
    return this.db.query("INSERT OR IGNORE INTO deliveries (id, event, received_at) VALUES (?, ?, ?)").run(id, event, now).changes > 0;
  }

  pruneDeliveries(olderThan: number) {
    this.db.query("DELETE FROM deliveries WHERE received_at < ?").run(olderThan);
  }

  track(p: { repo: string; number: number; source: "explicit" | "filter"; sessionId: string | null; now: number }) {
    const key = prKey(p.repo, p.number);
    this.db
      .query(
        `INSERT INTO prs (key, repo, number, tracked, source, session_id, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET tracked = 1,
           source = CASE WHEN prs.source = 'explicit' THEN 'explicit' ELSE excluded.source END,
           session_id = COALESCE(excluded.session_id, prs.session_id),
           updated_at = excluded.updated_at`,
      )
      .run(key, p.repo, p.number, p.source, p.sessionId, p.now);
    return key;
  }

  getPr(key: string): PrRecord | null {
    const r = this.db.query("SELECT * FROM prs WHERE key = ?").get(key);
    return r ? toRecord(r) : null;
  }

  listPrs(opts: { trackedOnly: boolean }): PrRecord[] {
    const sql = opts.trackedOnly ? "SELECT * FROM prs WHERE tracked = 1 ORDER BY key" : "SELECT * FROM prs ORDER BY key";
    return this.db.query(sql).all().map(toRecord);
  }

  setTracked(key: string, tracked: boolean) {
    this.db.query("UPDATE prs SET tracked = ? WHERE key = ?").run(tracked ? 1 : 0, key);
  }

  setAutoMerge(key: string, enabled: boolean | null) {
    this.db.query("UPDATE prs SET auto_merge = ? WHERE key = ?").run(enabled === null ? null : enabled ? 1 : 0, key);
  }

  setReviewRequested(key: string, head: string | null) {
    this.db.query("UPDATE prs SET review_requested_head = ? WHERE key = ?").run(head, key);
  }

  setMergeAttempt(key: string, head: string | null) {
    this.db.query("UPDATE prs SET merge_attempt_head = ? WHERE key = ?").run(head, key);
  }

  saveEvaluation(key: string, evaluation: Evaluation, now: number) {
    this.db.query("UPDATE prs SET evaluation = ?, updated_at = ? WHERE key = ?").run(JSON.stringify(evaluation), now, key);
  }

  appendTransition(t: Transition, now: number): number {
    const r = this.db
      .query("INSERT INTO transitions (at, key, kind, json) VALUES (?, ?, ?, ?) RETURNING id")
      .get(now, prKey(t.repo, t.number), t.kind, JSON.stringify(t)) as { id: number };
    return r.id;
  }

  transitionsSince(id: number, limit = 500): StoredTransition[] {
    return this.db
      .query("SELECT id, at, json FROM transitions WHERE id > ? ORDER BY id LIMIT ?")
      .all(id, limit)
      .map((r: any) => ({ ...JSON.parse(r.json), id: r.id, at: r.at }));
  }

  getMeta(k: string): string | null {
    const r = this.db.query("SELECT v FROM meta WHERE k = ?").get(k) as { v: string } | null;
    return r?.v ?? null;
  }

  setMeta(k: string, v: string) {
    this.db.query("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
  }

  close() {
    this.db.close();
  }
}
