import { describe, expect, test } from "bun:test";
import { check } from "./fixtures/build.ts";
import { evaluateSnapshot } from "./fixtures/reason-table.ts";

describe("derived flags", () => {
  test("awaiting human when only approval is missing", () => {
    const evaluation = evaluateSnapshot({ approvals: [] });
    expect(evaluation.awaitingHuman).toBe(true);
    expect(evaluation.ready).toBe(false);
  });

  test("not awaiting human when something actionable remains", () => {
    const evaluation = evaluateSnapshot({ approvals: [], mergeable: "CONFLICTING" });
    expect(evaluation.awaitingHuman).toBe(false);
  });

  test("ready but not mergeable now while a human gate is pending", () => {
    const evaluation = evaluateSnapshot({
      checks: [check("build", "pass"), check("gate", "fail", { conclusion: "ACTION_REQUIRED" })],
      mergeStateStatus: "BLOCKED",
    });
    expect(evaluation.ready).toBe(true);
    expect(evaluation.mergeableNow).toBe(false);
    expect(evaluation.checks.gates).toEqual([
      { name: "gate", outcome: "fail", conclusion: "ACTION_REQUIRED" },
    ]);
  });

  test.each([
    ["CLEAN", true],
    ["UNSTABLE", true],
    ["HAS_HOOKS", true],
    ["BLOCKED", false],
    ["BEHIND", false],
  ])("mergeStateStatus %s gives mergeableNow=%p", (mergeStateStatus, isMergeableNow) => {
    expect(evaluateSnapshot({ mergeStateStatus }).mergeableNow).toBe(isMergeableNow);
  });

  test("last known mergeable carries over an UNKNOWN read", () => {
    const previous = evaluateSnapshot({ mergeable: "CONFLICTING" });
    const next = evaluateSnapshot({ mergeable: "UNKNOWN" }, {}, previous);
    expect(next.lastKnownMergeable).toBe("CONFLICTING");
  });

  test("failed checks list names, conclusions and requiredness", () => {
    const evaluation = evaluateSnapshot({
      checks: [check("build", "fail", { conclusion: "TIMED_OUT" }), check("lint", "fail")],
    });
    expect(evaluation.checks.failed).toEqual([
      { name: "build", conclusion: "TIMED_OUT", required: true, url: "https://ci.invalid/build" },
      { name: "lint", conclusion: "FAILURE", required: false, url: "https://ci.invalid/lint" },
    ]);
  });
});
