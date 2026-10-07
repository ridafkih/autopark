import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/core/evaluate.ts";
import { BUILTIN_PARSERS } from "../src/reviewers/index.ts";
import { check, config, greptileComment, HEAD, OLD, snap } from "./fixtures/build.ts";
import type { ReasonCode, Snapshot } from "../src/core/types.ts";

const parsers = new Map([["greptile", BUILTIN_PARSERS.greptile!]]);
const codes = (s: Snapshot, cfg = config()) => evaluate(s, cfg, parsers, null).reasons.map((r) => r.code);

type Row = [string, Partial<Snapshot>, ReasonCode[], Record<string, unknown>?];

function table(name: string, rows: Row[]) {
  describe(name, () => {
    test.each(rows)("%s", (...row: Row) => {
      const [, overrides, expected, cfg] = row;
      expect(codes(snap(overrides), cfg ? config(cfg) : config())).toEqual(expected);
    });
  });
}

test("baseline snapshot is ready and mergeable now", () => {
  const e = evaluate(snap(), config(), parsers, null);
  expect(e.reasons).toEqual([]);
  expect(e.ready).toBe(true);
  expect(e.mergeableNow).toBe(true);
  expect(e.awaitingHuman).toBe(false);
});

table("rule: open and not draft", [
  ["closed", { state: "CLOSED" }, ["closed"]],
  ["merged", { state: "MERGED" }, ["closed"]],
  ["draft", { isDraft: true }, ["draft"]],
  ["draft allowed by config", { isDraft: true }, [], { readiness: { allowDraft: true } }],
]);

table("rule: no conflict", [
  ["mergeable", { mergeable: "MERGEABLE" }, []],
  ["conflicting", { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, ["conflict"]],
  ["unknown is not ready yet", { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }, ["mergeability_unknown"]],
  ["conflict ignored when disabled", { mergeable: "CONFLICTING" }, [], { readiness: { noConflict: false } }],
]);

table("rule: required checks pass", [
  ["explicit required check failing", { checks: [check("build", "fail"), check("gate", "pass")] }, ["checks_failed"]],
  ["explicit required check pending", { checks: [check("build", "pending"), check("gate", "pass")] }, ["checks_pending"]],
  ["explicit required check missing from head", { checks: [check("lint", "pass"), check("gate", "pass")] }, ["checks_pending"]],
  ["github-required check failing", { checks: [check("build", "pass"), check("e2e", "fail", { isRequired: true })] }, ["checks_failed"]],
  ["optional check failing does not block", { checks: [check("build", "pass"), check("lint", "fail")] }, []],
  ["ignored check failing does not block", { checks: [check("build", "pass"), check("noise", "fail", { isRequired: true })] }, []],
  ["human gate waiting is never a failure", { checks: [check("build", "pass"), check("gate", "fail", { conclusion: "ACTION_REQUIRED", isRequired: true })] }, []],
  ["one failing run of a duplicated name wins", { checks: [check("build", "pass"), check("build", "fail")] }, ["checks_failed"]],
  ["disabled rule ignores failures", { checks: [check("build", "fail")] }, [], { readiness: { requiredChecksPass: false } }],
]);

describe("rule: required checks fall back to all checks when none are required", () => {
  const cfg = { checks: { useGitHubRequired: true, required: [], humanGates: [] } };
  test.each<Row>([
    ["any failure blocks", { checks: [check("lint", "fail"), check("unit", "pass")] }, ["checks_failed"]],
    ["any pending blocks", { checks: [check("lint", "pending")] }, ["checks_pending"]],
    ["no checks at all is green", { checks: [] }, []],
  ])("%s", (_l, o, expected) => expect(codes(snap(o), config(cfg))).toEqual(expected));
});

table("rule: reviewer score on head", [
  ["score meets threshold on head", { comments: [greptileComment(4, HEAD)] }, []],
  ["score below threshold on head", { comments: [greptileComment(3, HEAD)] }, ["review_below_threshold"]],
  ["score for an older commit is stale", { comments: [greptileComment(5, OLD)] }, ["review_stale"]],
  ["no review yet", { comments: [] }, ["review_missing"]],
  ["comment by another author is ignored", { comments: [{ ...greptileComment(5, HEAD), author: "mallory" }] }, ["review_missing"]],
  ["latest edit wins", { comments: [greptileComment(2, OLD, 1, "a"), greptileComment(5, HEAD, 2, "b")] }, []],
  ["optional reviewer never blocks", { comments: [] }, [], { reviewers: [{ name: "greptile", parser: "greptile", minScore: 4, required: false }] }],
  ["stale score accepted when head binding is off", { comments: [greptileComment(5, OLD)] }, [], { reviewers: [{ name: "greptile", parser: "greptile", minScore: 4, requireOnHead: false }] }],
  ["null threshold accepts any score", { comments: [greptileComment(1, HEAD)] }, [], { reviewers: [{ name: "greptile", parser: "greptile", minScore: null }] }],
]);

const thread = (id: string, resolved: boolean, outdated = false) => ({ id, resolved, outdated, author: "greptile-apps", path: "a.ts", url: null });

table("rule: no unresolved threads", [
  ["all resolved", { threads: [thread("t1", true)] }, []],
  ["one open", { threads: [thread("t1", false), thread("t2", true)] }, ["threads_open"]],
  ["outdated but open still blocks", { threads: [thread("t1", false, true)] }, ["threads_open"]],
  ["outdated ignored when configured", { threads: [thread("t1", false, true)] }, [], { readiness: { countOutdatedThreads: false } }],
  ["disabled rule", { threads: [thread("t1", false)] }, [], { readiness: { noUnresolvedThreads: false } }],
]);

table("rule: approval on head", [
  ["approved on head", {}, []],
  ["approval on an older commit is stale", { approvals: [{ login: "r", state: "APPROVED", sha: OLD }] }, ["approval_stale"]],
  ["no approval", { approvals: [] }, ["approval_missing"]],
  ["changes requested", { approvals: [{ login: "r", state: "APPROVED", sha: HEAD }, { login: "q", state: "CHANGES_REQUESTED", sha: HEAD }] }, ["changes_requested"]],
  ["two approvals required", {}, ["approval_missing"], { readiness: { minApprovals: 2 } }],
  ["stale approval counts when head binding is off", { approvals: [{ login: "r", state: "APPROVED", sha: OLD }] }, [], { readiness: { approvalOnHead: false } }],
  ["zero approvals required", { approvals: [] }, [], { readiness: { minApprovals: 0 } }],
]);

describe("derived flags", () => {
  test("awaiting human when only approval is missing", () => {
    const e = evaluate(snap({ approvals: [] }), config(), parsers, null);
    expect(e.awaitingHuman).toBe(true);
    expect(e.ready).toBe(false);
  });

  test("not awaiting human when something actionable remains", () => {
    const e = evaluate(snap({ approvals: [], mergeable: "CONFLICTING" }), config(), parsers, null);
    expect(e.awaitingHuman).toBe(false);
  });

  test("ready but not mergeable now while a human gate is pending", () => {
    const e = evaluate(snap({ checks: [check("build", "pass"), check("gate", "fail", { conclusion: "ACTION_REQUIRED" })], mergeStateStatus: "BLOCKED" }), config(), parsers, null);
    expect(e.ready).toBe(true);
    expect(e.mergeableNow).toBe(false);
    expect(e.checks.gates).toEqual([{ name: "gate", outcome: "fail", conclusion: "ACTION_REQUIRED" }]);
  });

  test.each([
    ["CLEAN", true],
    ["UNSTABLE", true],
    ["HAS_HOOKS", true],
    ["BLOCKED", false],
    ["BEHIND", false],
  ])("mergeStateStatus %s gives mergeableNow=%p", (mss, expected) => {
    expect(evaluate(snap({ mergeStateStatus: mss }), config(), parsers, null).mergeableNow).toBe(expected);
  });

  test("last known mergeable carries over an UNKNOWN read", () => {
    const prev = evaluate(snap({ mergeable: "CONFLICTING" }), config(), parsers, null);
    const next = evaluate(snap({ mergeable: "UNKNOWN" }), config(), parsers, prev);
    expect(next.lastKnownMergeable).toBe("CONFLICTING");
  });

  test("failed checks list names, conclusions and requiredness", () => {
    const e = evaluate(snap({ checks: [check("build", "fail", { conclusion: "TIMED_OUT" }), check("lint", "fail")] }), config(), parsers, null);
    expect(e.checks.failed).toEqual([
      { name: "build", conclusion: "TIMED_OUT", required: true, url: "https://ci.invalid/build" },
      { name: "lint", conclusion: "FAILURE", required: false, url: "https://ci.invalid/lint" },
    ]);
  });
});

const behind = (behindBy: number, files: string[] = [], truncated = false) => ({ baseComparison: { behindBy, files, truncated } });
const fresh = (policy: string, extra: Record<string, unknown> = {}) => ({ readiness: { baseFreshness: { policy, ...extra } } });

table("rule: base freshness", [
  ["off ignores a moved base", behind(40, ["src/a.ts"]), [], fresh("off")],
  ["off ignores an unknown comparison", { baseComparison: null }, [], fresh("off")],
  ["contains-tip: head contains the base tip", behind(0), [], fresh("contains-tip")],
  ["contains-tip: base moved one commit", behind(1, ["README.md"]), ["stale_base"], fresh("contains-tip")],
  ["max-behind: within budget", behind(3), [], fresh("max-behind", { maxBehind: 3 })],
  ["max-behind: over budget", behind(4), ["stale_base"], fresh("max-behind", { maxBehind: 3 })],
  ["max-behind: zero budget behaves like contains-tip", behind(1), ["stale_base"], fresh("max-behind")],
  ["paths: base moved outside watched paths", behind(9, ["docs/guide.md"]), [], fresh("paths", { paths: ["apps/web/**", "budgets/*.json"] })],
  ["paths: base touched a watched path", behind(2, ["docs/guide.md", "budgets/bundle.json"]), ["stale_base"], fresh("paths", { paths: ["apps/web/**", "budgets/*.json"] })],
  ["paths: nested glob match", behind(1, ["apps/web/src/main.tsx"]), ["stale_base"], fresh("paths", { paths: ["apps/web/**"] })],
  ["paths: truncated file list is treated as touched", behind(500, ["docs/a.md"], true), ["stale_base"], fresh("paths", { paths: ["apps/web/**"] })],
  ["paths: head already contains the tip", behind(0), [], fresh("paths", { paths: ["**"] })],
  ["comparison unavailable blocks without being actionable", { baseComparison: null }, ["base_unknown"], fresh("contains-tip")],
  ["closed PRs skip the rule", { state: "MERGED", ...behind(5) }, ["closed"], fresh("contains-tip")],
]);

describe("base freshness detail", () => {
  test("stale evaluation records behind count and touched paths", () => {
    const e = evaluate(snap(behind(2, ["budgets/bundle.json", "docs/x.md"])), config(fresh("paths", { paths: ["budgets/*.json"] })), parsers, null);
    expect(e.base).toEqual({ sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", behindBy: 2, touched: ["budgets/bundle.json"], stale: true, policy: "paths" });
    expect(e.reasons[0]!.detail).toContain("budgets/bundle.json");
    expect(e.awaitingHuman).toBe(false);
  });
});
