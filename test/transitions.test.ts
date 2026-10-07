import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/core/evaluate.ts";
import { diff } from "../src/core/transitions.ts";
import { BUILTIN_PARSERS } from "../src/reviewers/index.ts";
import { check, config, greptileComment, HEAD, HEAD2, OLD, snap } from "./fixtures/build.ts";
import type { Evaluation, Snapshot, TransitionKind } from "../src/core/types.ts";

const parsers = new Map([["greptile", BUILTIN_PARSERS.greptile!]]);
const cfg = config({ readiness: { baseFreshness: { policy: "contains-tip" } } });

function ev(o: Partial<Snapshot> | null, prev: Evaluation | null = null) {
  return o === null ? null : evaluate(snap(o), cfg, parsers, prev);
}

type Row = [
  string,
  Partial<Snapshot> | null,
  Partial<Snapshot>,
  TransitionKind[],
  { exhausted?: boolean }?,
];

function table(name: string, kinds: TransitionKind[], rows: Row[]) {
  describe(name, () => {
    test.each(rows)("%s", (...row: Row) => {
      const [, prevO, nextO, expected, opts] = row;
      const prev = ev(prevO);
      const next = ev(nextO, prev)!;
      const got = diff(prev, next, { mergeabilityExhausted: opts?.exhausted })
        .map((t) => t.kind)
        .filter((k) => kinds.includes(k));
      expect(got).toEqual(expected);
    });
  });
}

const unapproved = { approvals: [] };
const failing = (name = "build") => ({ checks: [check(name, "fail"), check("gate", "pass")] });

table(
  "transition: merged and closed",
  ["merged", "closed", "ready", "not_ready", "conflicted"],
  [
    ["open to merged", {}, { state: "MERGED" }, ["merged"]],
    ["open to closed", {}, { state: "CLOSED" }, ["closed"]],
    ["merged stays merged", { state: "MERGED" }, { state: "MERGED" }, []],
    [
      "closed with a conflict only reports closed",
      { mergeable: "MERGEABLE" },
      { state: "CLOSED", mergeable: "CONFLICTING" },
      ["closed"],
    ],
    ["first sight of a merged PR", null, { state: "MERGED" }, ["merged"]],
  ],
);

table(
  "transition: head moved",
  ["head_moved"],
  [
    ["same head", {}, {}, []],
    ["new head", { headSha: HEAD }, { headSha: HEAD2 }, ["head_moved"]],
    ["first sight is not a move", null, { headSha: HEAD2 }, []],
  ],
);

table(
  "transition: conflicts",
  ["conflicted", "conflict_resolved", "mergeability_unknown"],
  [
    [
      "mergeable to conflicting",
      { mergeable: "MERGEABLE" },
      { mergeable: "CONFLICTING" },
      ["conflicted"],
    ],
    [
      "conflicting to mergeable",
      { mergeable: "CONFLICTING" },
      { mergeable: "MERGEABLE" },
      ["conflict_resolved"],
    ],
    [
      "conflicting stays conflicting",
      { mergeable: "CONFLICTING" },
      { mergeable: "CONFLICTING" },
      [],
    ],
    [
      "unknown read holds the last known value",
      { mergeable: "CONFLICTING" },
      { mergeable: "UNKNOWN" },
      [],
    ],
    [
      "unknown then conflicting after mergeable",
      { mergeable: "MERGEABLE" },
      { mergeable: "CONFLICTING" },
      ["conflicted"],
    ],
    ["first sight conflicting", null, { mergeable: "CONFLICTING" }, ["conflicted"]],
    ["first sight mergeable", null, { mergeable: "MERGEABLE" }, []],
    [
      "unknown after exhausted backoff",
      { mergeable: "MERGEABLE" },
      { mergeable: "UNKNOWN" },
      ["mergeability_unknown"],
      { exhausted: true },
    ],
    [
      "unknown again is not repeated",
      { mergeable: "UNKNOWN" },
      { mergeable: "UNKNOWN" },
      [],
      { exhausted: true },
    ],
  ],
);

table(
  "transition: stale base",
  ["stale_base"],
  [
    ["base tip contained", {}, {}, []],
    [
      "base moves past head",
      {},
      { baseSha: "c".repeat(40), baseComparison: { behindBy: 2, files: [], truncated: false } },
      ["stale_base"],
    ],
    [
      "still stale on same head and base",
      { baseComparison: { behindBy: 2, files: [], truncated: false } },
      { baseComparison: { behindBy: 2, files: [], truncated: false } },
      [],
    ],
    [
      "base moves again while stale",
      { baseComparison: { behindBy: 2, files: [], truncated: false } },
      { baseSha: "c".repeat(40), baseComparison: { behindBy: 3, files: [], truncated: false } },
      ["stale_base"],
    ],
    [
      "new head still behind",
      { baseComparison: { behindBy: 2, files: [], truncated: false } },
      { headSha: HEAD2, baseComparison: { behindBy: 1, files: [], truncated: false } },
      ["stale_base"],
    ],
    [
      "merge of base clears it silently",
      { baseComparison: { behindBy: 2, files: [], truncated: false } },
      { headSha: HEAD2, baseComparison: { behindBy: 0, files: [], truncated: false } },
      [],
    ],
  ],
);

table(
  "transition: checks",
  ["checks_failed", "checks_passed"],
  [
    ["green stays green", {}, {}, []],
    ["required check fails", {}, failing(), ["checks_failed"]],
    ["same failure is not repeated", failing(), failing(), []],
    [
      "another check fails later",
      failing("build"),
      { checks: [check("build", "fail"), check("lint", "fail"), check("gate", "pass")] },
      ["checks_failed"],
    ],
    [
      "optional failure is reported too",
      {},
      { checks: [check("build", "pass"), check("lint", "fail"), check("gate", "pass")] },
      ["checks_failed"],
    ],
    [
      "failure fixed on a new head",
      { ...failing(), headSha: HEAD },
      { headSha: HEAD2, approvals: [], comments: [] },
      ["checks_passed"],
    ],
    ["pending to green", { checks: [check("build", "pending")] }, {}, ["checks_passed"]],
    [
      "same failure on a new head is reported again",
      { ...failing(), headSha: HEAD },
      { ...failing(), headSha: HEAD2 },
      ["checks_failed"],
    ],
    ["first sight green", null, {}, ["checks_passed"]],
    ["first sight failing", null, failing(), ["checks_failed"]],
  ],
);

table(
  "transition: review scored",
  ["review_scored"],
  [
    ["unchanged score", {}, {}, []],
    ["first score arrives", { comments: [] }, {}, ["review_scored"]],
    [
      "score changes on edit",
      { comments: [greptileComment(3, HEAD, 1)] },
      { comments: [greptileComment(5, HEAD, 2)] },
      ["review_scored"],
    ],
    [
      "re-review of the same commit with the same score",
      { comments: [greptileComment(5, HEAD, 1)] },
      { comments: [greptileComment(5, HEAD, 2)] },
      ["review_scored"],
    ],
    [
      "score for an old commit still reported",
      { comments: [] },
      { comments: [greptileComment(5, OLD)] },
      ["review_scored"],
    ],
    ["summary disappears", {}, { comments: [] }, []],
  ],
);

const t = (id: string, resolved = false) => ({
  id,
  resolved,
  outdated: false,
  author: "greptile-apps",
  path: "a.ts",
  url: null,
});

table(
  "transition: threads",
  ["threads_open"],
  [
    ["none to none", {}, {}, []],
    ["one opens", {}, { threads: [t("a")] }, ["threads_open"]],
    ["count grows", { threads: [t("a")] }, { threads: [t("a"), t("b")] }, ["threads_open"]],
    ["all resolved", { threads: [t("a")] }, { threads: [t("a", true)] }, ["threads_open"]],
    ["unchanged count", { threads: [t("a")] }, { threads: [t("b")] }, []],
    ["first sight with none", null, {}, []],
  ],
);

table(
  "transition: approvals",
  ["approved_on_head", "approval_stale"],
  [
    ["approval lands on head", unapproved, {}, ["approved_on_head"]],
    ["still approved", {}, {}, []],
    [
      "head moves after approval",
      { headSha: HEAD },
      { headSha: HEAD2, approvals: [{ login: "reviewer", state: "APPROVED", sha: HEAD }] },
      ["approval_stale"],
    ],
    [
      "stale stays stale",
      { approvals: [{ login: "r", state: "APPROVED", sha: OLD }] },
      { approvals: [{ login: "r", state: "APPROVED", sha: OLD }] },
      [],
    ],
    [
      "re-approved on the new head",
      { approvals: [{ login: "r", state: "APPROVED", sha: OLD }] },
      {},
      ["approved_on_head"],
    ],
    [
      "first sight stale",
      null,
      { approvals: [{ login: "r", state: "APPROVED", sha: OLD }] },
      ["approval_stale"],
    ],
  ],
);

table(
  "transition: awaiting human",
  ["awaiting_human"],
  [
    ["everything but approval is green", { comments: [] }, unapproved, ["awaiting_human"]],
    ["already awaiting", unapproved, unapproved, []],
    [
      "actionable item blocks it",
      { comments: [] },
      { ...unapproved, mergeable: "CONFLICTING" },
      [],
    ],
  ],
);

table(
  "transition: ready",
  ["ready", "not_ready"],
  [
    ["becomes ready", unapproved, {}, ["ready"]],
    ["stays ready", {}, {}, []],
    ["loses readiness", {}, { mergeable: "CONFLICTING" }, ["not_ready"]],
    ["stays not ready", unapproved, { ...unapproved, threads: [t("a")] }, []],
    ["first sight ready", null, {}, ["ready"]],
    ["first sight not ready", null, unapproved, ["not_ready"]],
    ["closing a ready PR is not not_ready", {}, { state: "CLOSED" }, []],
  ],
);

describe("transition payloads", () => {
  test("checks_failed names each new failure with requiredness", () => {
    const prev = ev({})!;
    const next = ev(
      {
        checks: [
          check("build", "fail", { conclusion: "TIMED_OUT" }),
          check("lint", "fail"),
          check("gate", "pass"),
        ],
      },
      prev,
    )!;
    const tr = diff(prev, next).find((x) => x.kind === "checks_failed")!;
    expect(tr.data.names).toEqual(["build", "lint"]);
    expect(tr.data.required).toEqual(["build"]);
    expect(tr.reason).toBe("required failed: build (TIMED_OUT); optional failed: lint (FAILURE)");
    expect(tr.head).toBe(HEAD);
  });

  test("review_scored carries bot, score and reviewed head", () => {
    const tr = diff(ev({ comments: [] }), ev({ comments: [greptileComment(3, HEAD)] })!).find(
      (x) => x.kind === "review_scored",
    )!;
    expect(tr.data).toMatchObject({
      bot: "greptile",
      score: 3,
      maxScore: 5,
      head: HEAD,
      onHead: true,
      meetsThreshold: false,
    });
  });

  test("not_ready lists every reason", () => {
    const tr = diff(ev({}), ev({ mergeable: "CONFLICTING", threads: [t("a")] })!).find(
      (x) => x.kind === "not_ready",
    )!;
    expect(tr.data.reasons).toEqual([
      { code: "conflict", detail: "conflicts with main" },
      { code: "threads_open", detail: "1 unresolved review thread(s)" },
    ]);
  });

  test("ordering puts head_moved first and readiness last", () => {
    const kinds = diff(ev({}), ev({ headSha: HEAD2, mergeable: "CONFLICTING" })!).map(
      (x) => x.kind,
    );
    expect(kinds[0]).toBe("head_moved");
    expect(kinds.at(-1)).toBe("not_ready");
  });

  test("every transition carries repo, number and head", () => {
    for (const tr of diff(null, ev(failing())!)) {
      expect(tr).toMatchObject({ repo: "acme/widgets", number: 7, head: HEAD });
      expect(tr.reason.length).toBeGreaterThan(0);
    }
  });
});
