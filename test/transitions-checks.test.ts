import { check, greptileComment, HEAD, HEAD2, OLD } from "./fixtures/build.ts";
import { failing, thread, transitionTable } from "./fixtures/transition-table.ts";

transitionTable(
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

transitionTable(
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

transitionTable(
  "transition: threads",
  ["threads_open"],
  [
    ["none to none", {}, {}, []],
    ["one opens", {}, { threads: [thread("a")] }, ["threads_open"]],
    [
      "count grows",
      { threads: [thread("a")] },
      { threads: [thread("a"), thread("b")] },
      ["threads_open"],
    ],
    [
      "all resolved",
      { threads: [thread("a")] },
      { threads: [thread("a", true)] },
      ["threads_open"],
    ],
    ["unchanged count", { threads: [thread("a")] }, { threads: [thread("b")] }, []],
    ["first sight with none", null, {}, []],
  ],
);
