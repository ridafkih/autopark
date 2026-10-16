import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson, stringAt } from "../src/core/json.ts";
import { actionLines, actionableItems, STOP_HEADER, type TrackedView } from "../src/core/stop.ts";
import { resolvePaths } from "../src/daemon/paths.ts";
import { stopOutput } from "../src/hooks/run.ts";
import { hookState, view } from "./fixtures/hook-state.ts";
import { stopConfig, view as stopView } from "./fixtures/stop-views.ts";

const MINUTE = 60_000;
const scope = { sessionId: "s1", repos: [] };

const rateLimited = { kind: "rate_limited" as const, since: 0, ageMs: 12 * MINUTE };

const conflicting = stopView({ mergeable: "CONFLICTING" }).evaluation;

const staleView = (extra: Partial<TrackedView> = {}): TrackedView => ({
  ...stopView({}),
  reviewRequestedHead: null,
  stale: rateLimited,
  ...extra,
});

function stopper() {
  const paths = resolvePaths(mkdtempSync(join(tmpdir(), "apl-stale-")));
  return (views: TrackedView[]) => {
    const output = stopOutput(hookState({ views }), { stop_hook_active: false }, paths);
    return output === null ? null : parseJson(output);
  };
}

describe("stale PRs in the stop hook", () => {
  test("a stale PR is listed with its reason and age", () => {
    const items = actionableItems([staleView()], stopConfig.hooks.stop, scope);
    expect(actionLines(items)).toEqual(["#7 stale:rate_limited 12m"]);
  });

  test("staleness joins the PR's other codes", () => {
    const items = actionableItems(
      [
        staleView({
          evaluation: conflicting,
          stale: { kind: "error", since: 0, ageMs: 2 * MINUTE },
        }),
      ],
      stopConfig.hooks.stop,
      scope,
    );
    expect(actionLines(items)).toEqual(["#7 conflict, stale:error 2m"]);
  });

  test("a stale spell is reported once, not on every stop", () => {
    const stop = stopper();
    const stale = { ...view({}), stale: rateLimited };
    const first = stop([stale]);
    expect(stringAt(first, "reason")).toStartWith(STOP_HEADER);
    expect(stringAt(first, "reason")).toEndWith("#7 stale:rate_limited 12m");
    expect(stop([{ ...stale, stale: { ...rateLimited, ageMs: 13 * MINUTE } }])).toBeNull();
  });

  test("a PR turning stale changes the fingerprint", () => {
    const stop = stopper();
    const conflict = view({ mergeable: "CONFLICTING" });
    stop([conflict]);
    expect(stop([conflict])).toBeNull();
    const turned = stop([{ ...conflict, stale: rateLimited }]);
    expect(stringAt(turned, "reason")).toEndWith("#7 conflict, stale:rate_limited 12m");
    expect(stringAt(stop([conflict]), "reason")).toStartWith(STOP_HEADER);
  });
});
