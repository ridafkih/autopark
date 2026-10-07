import { describe, expect, test } from "bun:test";
import { check } from "./fixtures/build.ts";
import {
  evaluateSnapshot,
  reasonCodes,
  reasonTable,
  type ReasonRow,
} from "./fixtures/reason-table.ts";

test("baseline snapshot is ready and mergeable now", () => {
  const evaluation = evaluateSnapshot();
  expect(evaluation.reasons).toEqual([]);
  expect(evaluation.ready).toBe(true);
  expect(evaluation.mergeableNow).toBe(true);
  expect(evaluation.awaitingHuman).toBe(false);
});

reasonTable("rule: open and not draft", [
  ["closed", { state: "CLOSED" }, ["closed"]],
  ["merged", { state: "MERGED" }, ["closed"]],
  ["draft", { isDraft: true }, ["draft"]],
  ["draft allowed by config", { isDraft: true }, [], { readiness: { allowDraft: true } }],
]);

reasonTable("rule: no conflict", [
  ["mergeable", { mergeable: "MERGEABLE" }, []],
  ["conflicting", { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, ["conflict"]],
  [
    "unknown is not ready yet",
    { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" },
    ["mergeability_unknown"],
  ],
  [
    "conflict ignored when disabled",
    { mergeable: "CONFLICTING" },
    [],
    { readiness: { noConflict: false } },
  ],
]);

reasonTable("rule: required checks pass", [
  [
    "explicit required check failing",
    { checks: [check("build", "fail"), check("gate", "pass")] },
    ["checks_failed"],
  ],
  [
    "explicit required check pending",
    { checks: [check("build", "pending"), check("gate", "pass")] },
    ["checks_pending"],
  ],
  [
    "explicit required check missing from head",
    { checks: [check("lint", "pass"), check("gate", "pass")] },
    ["checks_pending"],
  ],
  [
    "github-required check failing",
    { checks: [check("build", "pass"), check("e2e", "fail", { isRequired: true })] },
    ["checks_failed"],
  ],
  [
    "optional check failing does not block",
    { checks: [check("build", "pass"), check("lint", "fail")] },
    [],
  ],
  [
    "ignored check failing does not block",
    { checks: [check("build", "pass"), check("noise", "fail", { isRequired: true })] },
    [],
  ],
  [
    "human gate waiting is never a failure",
    {
      checks: [
        check("build", "pass"),
        check("gate", "fail", { conclusion: "ACTION_REQUIRED", isRequired: true }),
      ],
    },
    [],
  ],
  [
    "one failing run of a duplicated name wins",
    { checks: [check("build", "pass"), check("build", "fail")] },
    ["checks_failed"],
  ],
  [
    "disabled rule ignores failures",
    { checks: [check("build", "fail")] },
    [],
    { readiness: { requiredChecksPass: false } },
  ],
]);

describe("rule: required checks fall back to all checks when none are required", () => {
  const overrides = { checks: { useGitHubRequired: true, required: [], humanGates: [] } };
  test.each<ReasonRow>([
    [
      "any failure blocks",
      { checks: [check("lint", "fail"), check("unit", "pass")] },
      ["checks_failed"],
    ],
    ["any pending blocks", { checks: [check("lint", "pending")] }, ["checks_pending"]],
    ["no checks at all is green", { checks: [] }, []],
  ])("%s", (label, changes, expected) => {
    expect(reasonCodes(changes, overrides)).toEqual(expected);
  });
});
