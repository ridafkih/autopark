import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/daemon/store.ts";
import { FileSink } from "../src/daemon/log.ts";
import { MemorySink } from "../src/daemon/memory-sink.ts";

describe("delivery dedupe", () => {
  test.each([
    ["new id is accepted", ["a"], [true]],
    ["same id twice is rejected the second time", ["a", "a"], [true, false]],
    ["distinct ids are all accepted", ["a", "b", "c"], [true, true, true]],
    ["redelivery after others is still rejected", ["a", "b", "a"], [true, true, false]],
  ] as const)("%s", (_l, ids, expected) => {
    const s = new Store(":memory:");
    expect(ids.map((id) => s.markDelivery(id, "push", 1))).toEqual([...expected]);
  });

  test("prune forgets old deliveries only", () => {
    const s = new Store(":memory:");
    s.markDelivery("old", "push", 100);
    s.markDelivery("new", "push", 1000);
    s.pruneDeliveries(500);
    expect(s.markDelivery("old", "push", 1001)).toBe(true);
    expect(s.markDelivery("new", "push", 1001)).toBe(false);
  });

  test("dedupe survives reopening the database file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apl-")), "state.db");
    new Store(path).markDelivery("x", "push", 1);
    expect(new Store(path).markDelivery("x", "push", 2)).toBe(false);
  });
});

describe("pr records", () => {
  test("track, untrack and flags round-trip", () => {
    const s = new Store(":memory:");
    s.track({ repo: "Acme/Widgets", number: 7, source: "explicit", sessionId: "s1", now: 1 });
    expect(s.getPullRequest("acme/widgets#7")).toMatchObject({
      repo: "Acme/Widgets",
      number: 7,
      tracked: true,
      source: "explicit",
      sessionId: "s1",
      autoMerge: null,
    });
    s.setAutoMerge("acme/widgets#7", true);
    s.setReviewRequested("acme/widgets#7", "abc");
    s.setMergeAttempt("acme/widgets#7", "abc");
    expect(s.getPullRequest("acme/widgets#7")).toMatchObject({
      autoMerge: true,
      reviewRequestedHead: "abc",
      mergeAttemptHead: "abc",
    });
    s.setTracked("acme/widgets#7", false);
    expect(s.listPullRequests({ trackedOnly: true })).toEqual([]);
    expect(s.listPullRequests({ trackedOnly: false })).toHaveLength(1);
  });

  test("re-tracking keeps flags and an explicit source wins over filter", () => {
    const s = new Store(":memory:");
    s.track({ repo: "acme/widgets", number: 7, source: "filter", sessionId: null, now: 1 });
    s.setAutoMerge("acme/widgets#7", true);
    s.track({ repo: "acme/widgets", number: 7, source: "explicit", sessionId: "s9", now: 2 });
    expect(s.getPullRequest("acme/widgets#7")).toMatchObject({
      source: "explicit",
      sessionId: "s9",
      autoMerge: true,
      tracked: true,
    });
    s.track({ repo: "acme/widgets", number: 7, source: "filter", sessionId: null, now: 3 });
    expect(s.getPullRequest("acme/widgets#7")).toMatchObject({
      source: "explicit",
      sessionId: "s9",
    });
  });

  test("transitions get increasing ids and can be read back", () => {
    const s = new Store(":memory:");
    const t = {
      kind: "ready" as const,
      repo: "acme/widgets",
      number: 7,
      head: "abc",
      reason: "r",
      data: {},
    };
    const a = s.appendTransition(t, 1);
    const b = s.appendTransition({ ...t, kind: "merged" }, 2);
    expect(b).toBeGreaterThan(a);
    expect(s.transitionsSince(a).map((x) => x.kind)).toEqual(["merged"]);
  });

  test("meta values persist", () => {
    const s = new Store(":memory:");
    s.setMeta("viewer", "octo");
    expect(s.getMeta("viewer")).toBe("octo");
    expect(s.getMeta("missing")).toBeNull();
  });
});

describe("transition sinks", () => {
  const lt = {
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
    sink.append(lt);
    sink.append({ ...lt, id: 2 });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([1, 2]);
  });

  test("memory sink records in order", () => {
    const sink = new MemorySink();
    sink.append(lt);
    expect(sink.lines).toEqual([lt]);
  });
});
