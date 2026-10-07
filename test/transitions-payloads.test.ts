import { describe, expect, test } from "bun:test";
import { diff } from "../src/core/transitions.ts";
import type { Evaluation, Transition, TransitionKind } from "../src/core/types.ts";
import { check, greptileComment, HEAD, HEAD2 } from "./fixtures/build.ts";
import { evaluateChanges, evaluatePrevious, failing, thread } from "./fixtures/transition-table.ts";

function transitionOf(previous: Evaluation | null, next: Evaluation, kind: TransitionKind) {
  const found = diff(previous, next).find((transition) => transition.kind === kind);
  expect(found).toBeDefined();
  return found as Transition;
}

describe("transition payloads", () => {
  test("checks_failed names each new failure with requiredness", () => {
    const previous = evaluateChanges({});
    const next = evaluateChanges(
      {
        checks: [
          check("build", "fail", { conclusion: "TIMED_OUT" }),
          check("lint", "fail"),
          check("gate", "pass"),
        ],
      },
      previous,
    );
    const transition = transitionOf(previous, next, "checks_failed");
    expect(transition.data.names).toEqual(["build", "lint"]);
    expect(transition.data.required).toEqual(["build"]);
    expect(transition.reason).toBe(
      "required failed: build (TIMED_OUT); optional failed: lint (FAILURE)",
    );
    expect(transition.head).toBe(HEAD);
  });

  test("review_scored carries bot, score and reviewed head", () => {
    const previous = evaluatePrevious({ comments: [] });
    const next = evaluateChanges({ comments: [greptileComment(3, HEAD)] });
    expect(transitionOf(previous, next, "review_scored").data).toMatchObject({
      bot: "greptile",
      score: 3,
      maxScore: 5,
      head: HEAD,
      onHead: true,
      meetsThreshold: false,
    });
  });

  test("not_ready lists every reason", () => {
    const previous = evaluatePrevious({});
    const next = evaluateChanges({ mergeable: "CONFLICTING", threads: [thread("a")] });
    expect(transitionOf(previous, next, "not_ready").data.reasons).toEqual([
      { code: "conflict", detail: "conflicts with main" },
      { code: "threads_open", detail: "1 unresolved review thread(s)" },
    ]);
  });

  test("ordering puts head_moved first and readiness last", () => {
    const previous = evaluatePrevious({});
    const next = evaluateChanges({ headSha: HEAD2, mergeable: "CONFLICTING" });
    const kinds = diff(previous, next).map((transition) => transition.kind);
    expect(kinds[0]).toBe("head_moved");
    expect(kinds.at(-1)).toBe("not_ready");
  });

  test("every transition carries repo, number and head", () => {
    for (const transition of diff(null, evaluateChanges(failing()))) {
      expect(transition).toMatchObject({ repo: "acme/widgets", number: 7, head: HEAD });
      expect(transition.reason.length).toBeGreaterThan(0);
    }
  });
});
