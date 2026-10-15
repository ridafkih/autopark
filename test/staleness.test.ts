import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate } from "../src/core/evaluate.ts";
import { PENDING_GRACE_MS, stalenessOf, type Freshness } from "../src/core/staleness.ts";
import { actionLines, actionableItems } from "../src/core/stop.ts";
import { pullRequestKey } from "../src/core/types.ts";
import { Store } from "../src/daemon/store.ts";
import { readViews } from "../src/hooks/views.ts";
import { greptile } from "../src/reviewers/greptile.ts";
import { config, REPO, snapshot } from "./fixtures/build.ts";

const MINUTE = 60_000;
const KEY = pullRequestKey(REPO, 7);

const fresh: Freshness = { eventAt: null, evaluatedAt: null, staleSince: null, failure: null };

const failure = (kind: "rate_limited" | "error", time: number) => ({
  kind,
  message: "boom",
  at: time,
});

function databaseWith(setup: (store: Store) => void) {
  const path = join(mkdtempSync(join(tmpdir(), "apl-views-")), "state.db");
  const store = new Store(path);
  store.track({ repo: REPO, number: 7, source: "explicit", sessionId: "s1", now: 0 });
  setup(store);
  store.close();
  return path;
}

describe("staleness", () => {
  test.each<[string, Freshness, number, ReturnType<typeof stalenessOf>]>([
    ["never touched", fresh, 0, null],
    ["evaluated after its last event", { ...fresh, eventAt: 5, evaluatedAt: 6 }, 10 * MINUTE, null],
    [
      "the last recompute was rate limited",
      { ...fresh, eventAt: 5, evaluatedAt: 1, staleSince: 5, failure: failure("rate_limited", 7) },
      12 * MINUTE + 5,
      { kind: "rate_limited", since: 5, ageMs: 12 * MINUTE },
    ],
    [
      "the last recompute failed",
      { ...fresh, evaluatedAt: 1, failure: failure("error", 7) },
      7 + MINUTE,
      { kind: "error", since: 7, ageMs: MINUTE },
    ],
    [
      "an event is still in flight",
      { ...fresh, eventAt: 5, evaluatedAt: 1, staleSince: 5 },
      5 + PENDING_GRACE_MS - 1,
      null,
    ],
    [
      "an event outlived the grace without an evaluation",
      { ...fresh, eventAt: 5, evaluatedAt: 1, staleSince: 5 },
      5 + PENDING_GRACE_MS,
      { kind: "pending", since: 5, ageMs: PENDING_GRACE_MS },
    ],
  ])("%s", (label, freshness, now, expected) => {
    expect(stalenessOf(freshness, now)).toEqual(expected);
  });
});

describe("stale PRs read from the store", () => {
  test("a PR that was never evaluated still shows up when its recompute failed", () => {
    const path = databaseWith((store) => {
      store.recordFailure(KEY, { kind: "rate_limited", message: "limited" }, 1000);
    });
    const views = readViews(path, 1000 + 3 * MINUTE);
    expect(views.map((entry) => [entry.evaluation.number, entry.stale?.kind])).toEqual([
      [7, "rate_limited"],
    ]);
    const items = actionableItems(views, config().hooks.stop, { sessionId: "s1", repos: [] });
    expect(actionLines(items)).toEqual(["#7 stale:rate_limited 3m"]);
  });

  test("an event newer than the stored evaluation shows as stale once the grace passes", () => {
    const evaluation = evaluate(snapshot(), config(), new Map([["greptile", greptile]]), null);
    const path = databaseWith((store) => {
      store.saveEvaluation(KEY, evaluation, 0, 0);
      store.markEvent(KEY, 1000);
    });
    expect(readViews(path, 1000 + MINUTE)[0]?.stale ?? null).toBeNull();
    expect(readViews(path, 1000 + 5 * MINUTE)[0]?.stale).toEqual({
      kind: "pending",
      since: 1000,
      ageMs: 5 * MINUTE,
    });
  });
});
