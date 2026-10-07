import { greptileComment, HEAD, OLD } from "./fixtures/build.ts";
import { reasonTable } from "./fixtures/reason-table.ts";

const thread = (id: string, isResolved: boolean, isOutdated = false) => ({
  id,
  resolved: isResolved,
  outdated: isOutdated,
  author: "greptile-apps",
  path: "a.ts",
  url: null,
});

const staleApproval = { approvals: [{ login: "reviewer", state: "APPROVED", sha: OLD }] };

reasonTable("rule: reviewer score on head", [
  ["score meets threshold on head", { comments: [greptileComment(4, HEAD)] }, []],
  [
    "score below threshold on head",
    { comments: [greptileComment(3, HEAD)] },
    ["review_below_threshold"],
  ],
  ["score for an older commit is stale", { comments: [greptileComment(5, OLD)] }, ["review_stale"]],
  ["no review yet", { comments: [] }, ["review_missing"]],
  [
    "comment by another author is ignored",
    { comments: [{ ...greptileComment(5, HEAD), author: "mallory" }] },
    ["review_missing"],
  ],
  [
    "latest edit wins",
    { comments: [greptileComment(2, OLD, 1, "a"), greptileComment(5, HEAD, 2, "b")] },
    [],
  ],
  [
    "optional reviewer never blocks",
    { comments: [] },
    [],
    { reviewers: [{ name: "greptile", parser: "greptile", minScore: 4, required: false }] },
  ],
  [
    "stale score accepted when head binding is off",
    { comments: [greptileComment(5, OLD)] },
    [],
    { reviewers: [{ name: "greptile", parser: "greptile", minScore: 4, requireOnHead: false }] },
  ],
  [
    "null threshold accepts any score",
    { comments: [greptileComment(1, HEAD)] },
    [],
    { reviewers: [{ name: "greptile", parser: "greptile", minScore: null }] },
  ],
]);

reasonTable("rule: no unresolved threads", [
  ["all resolved", { threads: [thread("t1", true)] }, []],
  ["one open", { threads: [thread("t1", false), thread("t2", true)] }, ["threads_open"]],
  ["outdated but open still blocks", { threads: [thread("t1", false, true)] }, ["threads_open"]],
  [
    "outdated ignored when configured",
    { threads: [thread("t1", false, true)] },
    [],
    { readiness: { countOutdatedThreads: false } },
  ],
  [
    "disabled rule",
    { threads: [thread("t1", false)] },
    [],
    { readiness: { noUnresolvedThreads: false } },
  ],
]);

reasonTable("rule: approval on head", [
  ["approved on head", {}, []],
  ["approval on an older commit is stale", staleApproval, ["approval_stale"]],
  ["no approval", { approvals: [] }, ["approval_missing"]],
  [
    "changes requested",
    {
      approvals: [
        { login: "reviewer", state: "APPROVED", sha: HEAD },
        { login: "requester", state: "CHANGES_REQUESTED", sha: HEAD },
      ],
    },
    ["changes_requested"],
  ],
  ["two approvals required", {}, ["approval_missing"], { readiness: { minApprovals: 2 } }],
  [
    "stale approval counts when head binding is off",
    staleApproval,
    [],
    { readiness: { approvalOnHead: false } },
  ],
  ["zero approvals required", { approvals: [] }, [], { readiness: { minApprovals: 0 } }],
]);
