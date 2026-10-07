import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/core/evaluate.ts";
import { actionableItems, decideStop, type TrackedView } from "../src/core/stop.ts";
import { BUILTIN_PARSERS } from "../src/reviewers/index.ts";
import { check, config, greptileComment, HEAD, OLD, snap } from "./fixtures/build.ts";
import type { Snapshot } from "../src/core/types.ts";

const parsers = new Map([["greptile", BUILTIN_PARSERS.greptile!]]);
const cfg = config({ readiness: { baseFreshness: { policy: "contains-tip" } }, hooks: { stop: { blockOnHeadMovedWithoutReview: true } } });

const view = (o: Partial<Snapshot>, extra: Partial<TrackedView> = {}): TrackedView => ({
  evaluation: evaluate(snap(o), cfg, parsers, null),
  sessionId: "s1",
  reviewRequestedHead: HEAD,
  ...extra,
});

const kindsFor = (v: TrackedView, stopCfg = cfg.hooks.stop) => actionableItems([v], stopCfg, { sessionId: "s1", repo: null }).map((i) => i.kind);

type Row = [string, Partial<Snapshot>, string[], Partial<TrackedView>?];

describe("actionable items", () => {
  test.each<Row>([
    ["ready PR has nothing to do", {}, []],
    ["conflict", { mergeable: "CONFLICTING" }, ["conflict"]],
    ["unknown mergeability is not actionable", { mergeable: "UNKNOWN" }, []],
    ["stale base", { baseComparison: { behindBy: 3, files: [], truncated: false } }, ["stale_base"]],
    ["failed required check", { checks: [check("build", "fail"), check("gate", "pass")] }, ["failed_checks"]],
    ["failed optional check only", { checks: [check("build", "pass"), check("lint", "fail"), check("gate", "pass")] }, []],
    ["pending checks never block", { checks: [check("build", "pending"), check("gate", "pending")] }, []],
    ["human gate waiting never blocks", { checks: [check("build", "pass"), check("gate", "fail", { conclusion: "ACTION_REQUIRED" })] }, []],
    ["score below threshold on head", { comments: [greptileComment(2, HEAD)] }, ["review_findings"]],
    ["low score on an old commit is only pending", { comments: [greptileComment(2, OLD)] }, []],
    ["missing review is pending", { comments: [] }, []],
    ["open threads", { threads: [{ id: "a", resolved: false, outdated: false, author: "x", path: null, url: null }] }, ["review_findings"]],
    ["head moved without review re-requested", { approvals: [{ login: "r", state: "APPROVED", sha: OLD }] }, ["review_not_requested"], { reviewRequestedHead: OLD }],
    ["head moved but already approved on head", {}, [], { reviewRequestedHead: OLD }],
    ["awaiting human with no request yet", { approvals: [] }, ["review_not_requested"], { reviewRequestedHead: null }],
    ["awaiting human with a request on head", { approvals: [] }, [], { reviewRequestedHead: HEAD }],
    ["closed PR is never actionable", { state: "CLOSED", mergeable: "CONFLICTING" }, []],
    ["several at once keep a stable order", { mergeable: "CONFLICTING", checks: [check("build", "fail")], comments: [greptileComment(1, HEAD)] }, ["conflict", "failed_checks", "review_findings"]],
  ])("%s", (...row: Row) => {
    const [, o, expected, extra] = row;
    expect(kindsFor(view(o, extra))).toEqual(expected);
  });

  test.each([
    ["blockOnConflict", { mergeable: "CONFLICTING" as const }],
    ["blockOnStaleBase", { baseComparison: { behindBy: 1, files: [], truncated: false } }],
    ["blockOnFailedChecks", { checks: [check("build", "fail")] }],
    ["blockOnReviewFindings", { comments: [greptileComment(1, HEAD)] }],
  ])("%s=false disables its item", (flag, o) => {
    expect(kindsFor(view(o), { ...cfg.hooks.stop, [flag]: false })).toEqual([]);
  });

  test("head-moved check is off by default", () => {
    expect(kindsFor(view({}, { reviewRequestedHead: OLD }), config().hooks.stop)).toEqual([]);
  });
});

describe("scope", () => {
  const mine = view({ mergeable: "CONFLICTING" }, { sessionId: "s1" });
  const other = { ...view({ mergeable: "CONFLICTING", number: 8 } as Partial<Snapshot>), sessionId: "s2" };
  const elsewhere = { ...view({ mergeable: "CONFLICTING", number: 9, repo: "acme/other" } as Partial<Snapshot>), sessionId: null };
  const all = [mine, other, elsewhere];
  test.each([
    ["session", ["acme/widgets#7"]],
    ["repo", ["acme/widgets#7", "acme/widgets#8"]],
    ["all", ["acme/widgets#7", "acme/widgets#8", "acme/other#9"]],
  ] as const)("scope %s", (scope, expected) => {
    const items = actionableItems(all, { ...cfg.hooks.stop, scope }, { sessionId: "s1", repo: "Acme/Widgets" });
    expect(items.map((i) => i.pr)).toEqual([...expected]);
  });
});

describe("decideStop", () => {
  const items = actionableItems([view({ mergeable: "CONFLICTING" })], cfg.hooks.stop, { sessionId: "s1", repo: null });

  test.each([
    ["nothing actionable allows and resets", [], false, 2, { decision: "allow", blocks: 0 }],
    ["first block", items, false, 0, { decision: "block", blocks: 1 }],
    ["fresh stop resets the counter", items, false, 5, { decision: "block", blocks: 1 }],
    ["continuing under the cap blocks again", items, true, 1, { decision: "block", blocks: 2 }],
    ["cap reached allows", items, true, 3, { decision: "allow", blocks: 0 }],
    ["over the cap allows", items, true, 7, { decision: "allow", blocks: 0 }],
  ] as const)("%s", (_l, its, active, prior, expected) => {
    const d = decideStop({ items: [...its], stopHookActive: active, priorBlocks: prior, maxBlocks: 3 });
    expect(d).toMatchObject(expected);
  });

  test("block reason is factual and lists each PR with its next step", () => {
    const d = decideStop({ items, stopHookActive: false, priorBlocks: 0, maxBlocks: 3 });
    expect(d.reason).toBe(
      "Tracked PRs have actionable items:\n- acme/widgets#7 conflict: conflicts with main. Next: merge main into the branch, resolve, push.",
    );
  });

  test("cap reached explains why it let go", () => {
    const d = decideStop({ items, stopHookActive: true, priorBlocks: 3, maxBlocks: 3 });
    expect(d.systemMessage).toContain("3");
  });
});
