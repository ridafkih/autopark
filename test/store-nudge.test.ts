import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/daemon/store.ts";

const state = {
  signature: "threads_open",
  since: 5,
  headMovedAt: null,
  lastNudgeAt: 10,
  count: 2,
  next: "address the review findings",
};

const track = (store: Store) =>
  store.track({ repo: "acme/widgets", number: 7, source: "explicit", sessionId: null, now: 1 });

describe("nudge and hold storage", () => {
  test("nudge state round-trips and clears", () => {
    const store = new Store(":memory:");
    const key = track(store);
    store.saveNudge(key, state);
    expect(store.getPullRequest(key)?.nudge).toEqual(state);
    store.saveNudge(key, null);
    expect(store.getPullRequest(key)?.nudge).toBeNull();
  });

  test("holds are set, replaced, listed and cleared", () => {
    const store = new Store(":memory:");
    store.setHold({ target: "acme/widgets#7", until: 100, reason: "a", createdAt: 1 });
    store.setHold({ target: "acme/widgets#7", until: 200, reason: "b", createdAt: 2 });
    store.setHold({ target: "*", until: 300, reason: null, createdAt: 3 });
    expect(store.listHolds()).toEqual([
      { target: "*", until: 300, reason: null, createdAt: 3 },
      { target: "acme/widgets#7", until: 200, reason: "b", createdAt: 2 },
    ]);
    store.clearHold("acme/widgets#7");
    expect(store.listHolds().map((hold) => hold.target)).toEqual(["*"]);
    store.clearAllHolds();
    expect(store.listHolds()).toEqual([]);
  });

  test("a database from before nudges gains the column on open", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apl-")), "state.db");
    const legacy = new Database(path, { create: true });
    legacy.run(
      "CREATE TABLE prs (key TEXT PRIMARY KEY, repo TEXT NOT NULL, number INTEGER NOT NULL, tracked INTEGER NOT NULL, source TEXT NOT NULL, session_id TEXT, auto_merge INTEGER, review_requested_head TEXT, merge_attempt_head TEXT, evaluation TEXT, updated_at INTEGER NOT NULL)",
    );
    legacy.close();
    const store = new Store(path);
    const key = track(store);
    store.saveNudge(key, state);
    expect(store.getPullRequest(key)?.nudge).toEqual(state);
  });

  test("a read-only view of an unmigrated database has no holds", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apl-")), "state.db");
    new Database(path, { create: true }).close();
    expect(new Store(path, { readonly: true }).listHolds()).toEqual([]);
  });
});
