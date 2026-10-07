import { describe, expect, test } from "bun:test";
import type { ActionKind, TrackedView } from "../src/core/stop.ts";
import type { Snapshot } from "../src/core/types.ts";
import { check, config, greptileComment, HEAD, OLD } from "./fixtures/build.ts";
import { kindsFor, stopConfig, view } from "./fixtures/stop-views.ts";

type Row = [string, Partial<Snapshot>, ActionKind[], Partial<TrackedView>?];

const openThread = {
  id: "a",
  resolved: false,
  outdated: false,
  author: "x",
  path: null,
  url: null,
};

describe("actionable items", () => {
  test.each<Row>([
    ["ready PR has nothing to do", {}, []],
    ["conflict", { mergeable: "CONFLICTING" }, ["conflict"]],
    ["unknown mergeability is not actionable", { mergeable: "UNKNOWN" }, []],
    [
      "stale base",
      { baseComparison: { behindBy: 3, files: [], truncated: false } },
      ["stale_base"],
    ],
    [
      "failed required check",
      { checks: [check("build", "fail"), check("gate", "pass")] },
      ["failed_checks"],
    ],
    [
      "failed optional check only",
      { checks: [check("build", "pass"), check("lint", "fail"), check("gate", "pass")] },
      [],
    ],
    [
      "pending checks never block",
      { checks: [check("build", "pending"), check("gate", "pending")] },
      [],
    ],
    [
      "human gate waiting never blocks",
      {
        checks: [check("build", "pass"), check("gate", "fail", { conclusion: "ACTION_REQUIRED" })],
      },
      [],
    ],
    [
      "score below threshold on head",
      { comments: [greptileComment(2, HEAD)] },
      ["review_findings"],
    ],
    ["low score on an old commit is only pending", { comments: [greptileComment(2, OLD)] }, []],
    ["missing review is pending", { comments: [] }, []],
    ["open threads", { threads: [openThread] }, ["review_findings"]],
    [
      "head moved without review re-requested",
      { approvals: [{ login: "reviewer", state: "APPROVED", sha: OLD }] },
      ["review_not_requested"],
      { reviewRequestedHead: OLD },
    ],
    ["head moved but already approved on head", {}, [], { reviewRequestedHead: OLD }],
    [
      "awaiting human with no request yet",
      { approvals: [] },
      ["review_not_requested"],
      { reviewRequestedHead: null },
    ],
    ["awaiting human with a request on head", { approvals: [] }, [], { reviewRequestedHead: HEAD }],
    ["closed PR is never actionable", { state: "CLOSED", mergeable: "CONFLICTING" }, []],
    [
      "several at once keep a stable order",
      {
        mergeable: "CONFLICTING",
        checks: [check("build", "fail")],
        comments: [greptileComment(1, HEAD)],
      },
      ["conflict", "failed_checks", "review_findings"],
    ],
  ])("%s", (...row: Row) => {
    const [, changes, expected, extra] = row;
    expect(kindsFor(view(changes, extra))).toEqual(expected);
  });

  test.each([
    ["blockOnConflict", { mergeable: "CONFLICTING" as const }],
    ["blockOnStaleBase", { baseComparison: { behindBy: 1, files: [], truncated: false } }],
    ["blockOnFailedChecks", { checks: [check("build", "fail")] }],
    ["blockOnReviewFindings", { comments: [greptileComment(1, HEAD)] }],
  ])("%s=false disables its item", (flag, changes) => {
    expect(kindsFor(view(changes), { ...stopConfig.hooks.stop, [flag]: false })).toEqual([]);
  });

  test("head-moved check is off by default", () => {
    expect(kindsFor(view({}, { reviewRequestedHead: OLD }), config().hooks.stop)).toEqual([]);
  });
});
