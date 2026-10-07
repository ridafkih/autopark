import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/daemon/store.ts";
import { FileSink } from "../src/daemon/log.ts";
import { MemorySink } from "../src/daemon/memory-sink.ts";
import { numberAt, parseJson } from "../src/core/json.ts";

describe("delivery dedupe", () => {
  test.each([
    ["new id is accepted", ["a"], [true]],
    ["same id twice is rejected the second time", ["a", "a"], [true, false]],
    ["distinct ids are all accepted", ["a", "b", "c"], [true, true, true]],
    ["redelivery after others is still rejected", ["a", "b", "a"], [true, true, false]],
  ] as const)("%s", (label, ids, expected) => {
    const store = new Store(":memory:");
    expect(ids.map((id) => store.markDelivery(id, "push", 1))).toEqual([...expected]);
  });

  test("prune forgets old deliveries only", () => {
    const store = new Store(":memory:");
    store.markDelivery("old", "push", 100);
    store.markDelivery("new", "push", 1000);
    store.pruneDeliveries(500);
    expect(store.markDelivery("old", "push", 1001)).toBe(true);
    expect(store.markDelivery("new", "push", 1001)).toBe(false);
  });

  test("dedupe survives reopening the database file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apl-")), "state.db");
    new Store(path).markDelivery("x", "push", 1);
    expect(new Store(path).markDelivery("x", "push", 2)).toBe(false);
  });
});

describe("pr records", () => {
  test("track, untrack and flags round-trip", () => {
    const store = new Store(":memory:");
    store.track({ repo: "Acme/Widgets", number: 7, source: "explicit", sessionId: "s1", now: 1 });
    expect(store.getPullRequest("acme/widgets#7")).toMatchObject({
      repo: "Acme/Widgets",
      number: 7,
      tracked: true,
      source: "explicit",
      sessionId: "s1",
      autoMerge: null,
    });
    store.setAutoMerge("acme/widgets#7", true);
    store.setReviewRequested("acme/widgets#7", "abc");
    store.setMergeAttempt("acme/widgets#7", "abc");
    expect(store.getPullRequest("acme/widgets#7")).toMatchObject({
      autoMerge: true,
      reviewRequestedHead: "abc",
      mergeAttemptHead: "abc",
    });
    store.setTracked("acme/widgets#7", false);
    expect(store.listPullRequests({ trackedOnly: true })).toEqual([]);
    expect(store.listPullRequests({ trackedOnly: false })).toHaveLength(1);
  });

  test("re-tracking keeps flags and an explicit source wins over filter", () => {
    const store = new Store(":memory:");
    store.track({ repo: "acme/widgets", number: 7, source: "filter", sessionId: null, now: 1 });
    store.setAutoMerge("acme/widgets#7", true);
    store.track({ repo: "acme/widgets", number: 7, source: "explicit", sessionId: "s9", now: 2 });
    expect(store.getPullRequest("acme/widgets#7")).toMatchObject({
      source: "explicit",
      sessionId: "s9",
      autoMerge: true,
      tracked: true,
    });
    store.track({ repo: "acme/widgets", number: 7, source: "filter", sessionId: null, now: 3 });
    expect(store.getPullRequest("acme/widgets#7")).toMatchObject({
      source: "explicit",
      sessionId: "s9",
    });
  });

  test("transitions get increasing ids and can be read back", () => {
    const store = new Store(":memory:");
    const transition = {
      kind: "ready" as const,
      repo: "acme/widgets",
      number: 7,
      head: "abc",
      reason: "r",
      data: {},
    };
    const firstId = store.appendTransition(transition, 1);
    const secondId = store.appendTransition({ ...transition, kind: "merged" }, 2);
    expect(secondId).toBeGreaterThan(firstId);
    const kinds = store.transitionsSince(firstId).map((stored) => stored.kind);
    expect(kinds).toEqual(["merged"]);
  });

  test("meta values persist", () => {
    const store = new Store(":memory:");
    store.setMeta("viewer", "octo");
    expect(store.getMeta("viewer")).toBe("octo");
    expect(store.getMeta("missing")).toBeNull();
  });
});

describe("transition sinks", () => {
  const loggedTransition = {
    id: 1,
    ts: "2026-10-06T00:00:00.000Z",
    kind: "ready" as const,
    repo: "acme/widgets",
    number: 7,
    head: "abc",
    reason: "r",
    data: {},
    title: "t",
    url: "u",
  };

  test("file sink appends one json object per line", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apl-")), "sub", "transitions.jsonl");
    const sink = new FileSink(path);
    sink.append(loggedTransition);
    sink.append({ ...loggedTransition, id: 2 });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const ids = lines.map((line) => numberAt(parseJson(line), "id"));
    expect(ids).toEqual([1, 2]);
  });

  test("memory sink records in order", () => {
    const sink = new MemorySink();
    sink.append(loggedTransition);
    expect(sink.lines).toEqual([loggedTransition]);
  });
});
