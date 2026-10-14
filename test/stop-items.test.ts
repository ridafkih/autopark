import { describe, expect, test } from "bun:test";
import {
  actionLines,
  actionableItems,
  type ActionKind,
  type TrackedView,
} from "../src/core/stop.ts";
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
    ["behind its base but mergeable is not actionable", { mergeStateStatus: "BEHIND" }, []],
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
      "head moved after a review request never re-requests",
      { approvals: [{ login: "reviewer", state: "APPROVED", sha: OLD }] },
      [],
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
    ["blockOnFailedChecks", { checks: [check("build", "fail")] }],
    ["blockOnReviewFindings", { comments: [greptileComment(1, HEAD)] }],
  ])("%s=false disables its item", (flag, changes) => {
    expect(kindsFor(view(changes), { ...stopConfig.hooks.stop, [flag]: false })).toEqual([]);
  });

  test("head-moved check is off by default", () => {
    expect(kindsFor(view({}, { reviewRequestedHead: OLD }), config().hooks.stop)).toEqual([]);
  });
});

const linesFor = (views: TrackedView[]) =>
  actionLines(actionableItems(views, stopConfig.hooks.stop, { sessionId: "s1", repos: [] }));

describe("action lines", () => {
  test.each<[string, Partial<Snapshot>, Partial<TrackedView>, string]>([
    ["conflict", { mergeable: "CONFLICTING" }, {}, "#7 conflict"],
    [
      "failed required checks by name",
      {
        checks: [
          check("build", "fail"),
          check("lint", "fail"),
          check("deploy", "fail", { isRequired: true }),
        ],
      },
      {},
      "#7 checks:build+deploy",
    ],
    [
      "open threads before low scores",
      { threads: [openThread, { ...openThread, id: "b" }], comments: [greptileComment(2, HEAD)] },
      {},
      "#7 threads:2, greptile:2/5",
    ],
    [
      "approval never requested",
      { approvals: [] },
      { reviewRequestedHead: null },
      "#7 approval_needed",
    ],
    [
      "nudged with nothing else to do",
      { checks: [check("build", "pending"), check("gate", "pending")] },
      {
        nudge: {
          signature: "checks_pending",
          since: 0,
          headMovedAt: null,
          lastNudgeAt: 1,
          count: 2,
          next: null,
        },
      },
      "#7 nudged:checks_pending",
    ],
  ])("%s", (label, changes, extra, expected) => {
    expect(linesFor([view(changes, extra)])).toEqual([expected]);
  });

  test("one line per PR joins every code", () => {
    const blocked = view({
      mergeable: "CONFLICTING",
      checks: [check("build", "fail"), check("gate", "pass")],
      threads: [openThread],
    });
    expect(linesFor([blocked, view({ number: 8 })])).toEqual([
      "#7 conflict, checks:build, threads:1",
    ]);
  });

  test("PRs from more than one repo keep the repo in the label", () => {
    const here = view({ mergeable: "CONFLICTING" });
    const there = view({ mergeable: "CONFLICTING", repo: "acme/other", number: 9 });
    expect(linesFor([here, there])).toEqual(["acme/widgets#7 conflict", "acme/other#9 conflict"]);
  });
});
