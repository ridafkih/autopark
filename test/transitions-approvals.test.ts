import { HEAD, HEAD2, OLD } from "./fixtures/build.ts";
import { thread, transitionTable, unapproved } from "./fixtures/transition-table.ts";

const staleApproval = { approvals: [{ login: "reviewer", state: "APPROVED", sha: OLD }] };

transitionTable(
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
    ["stale stays stale", staleApproval, staleApproval, []],
    ["re-approved on the new head", staleApproval, {}, ["approved_on_head"]],
    ["first sight stale", null, staleApproval, ["approval_stale"]],
  ],
);

transitionTable(
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

transitionTable(
  "transition: ready",
  ["ready", "not_ready"],
  [
    ["becomes ready", unapproved, {}, ["ready"]],
    ["stays ready", {}, {}, []],
    ["loses readiness", {}, { mergeable: "CONFLICTING" }, ["not_ready"]],
    ["stays not ready", unapproved, { ...unapproved, threads: [thread("a")] }, []],
    ["first sight ready", null, {}, ["ready"]],
    ["first sight not ready", null, unapproved, ["not_ready"]],
    ["closing a ready PR is not not_ready", {}, { state: "CLOSED" }, []],
  ],
);
