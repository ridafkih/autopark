import { describe, expect, test } from "bun:test";
import { evaluateSnapshot, reasonTable } from "./fixtures/reason-table.ts";

const behind = (behindBy: number, files: string[] = [], isTruncated = false) => ({
  baseComparison: { behindBy, files, truncated: isTruncated },
});

const freshness = (policy: string, extra: Record<string, unknown> = {}) => ({
  readiness: { baseFreshness: { policy, ...extra } },
});

reasonTable("rule: base freshness", [
  ["off ignores a moved base", behind(40, ["src/a.ts"]), [], freshness("off")],
  ["off ignores an unknown comparison", { baseComparison: null }, [], freshness("off")],
  ["contains-tip: head contains the base tip", behind(0), [], freshness("contains-tip")],
  [
    "contains-tip: base moved one commit",
    behind(1, ["README.md"]),
    ["stale_base"],
    freshness("contains-tip"),
  ],
  ["max-behind: within budget", behind(3), [], freshness("max-behind", { maxBehind: 3 })],
  ["max-behind: over budget", behind(4), ["stale_base"], freshness("max-behind", { maxBehind: 3 })],
  [
    "max-behind: zero budget behaves like contains-tip",
    behind(1),
    ["stale_base"],
    freshness("max-behind"),
  ],
  [
    "paths: base moved outside watched paths",
    behind(9, ["docs/guide.md"]),
    [],
    freshness("paths", { paths: ["apps/web/**", "budgets/*.json"] }),
  ],
  [
    "paths: base touched a watched path",
    behind(2, ["docs/guide.md", "budgets/bundle.json"]),
    ["stale_base"],
    freshness("paths", { paths: ["apps/web/**", "budgets/*.json"] }),
  ],
  [
    "paths: nested glob match",
    behind(1, ["apps/web/src/main.tsx"]),
    ["stale_base"],
    freshness("paths", { paths: ["apps/web/**"] }),
  ],
  [
    "paths: truncated file list is treated as touched",
    behind(500, ["docs/a.md"], true),
    ["stale_base"],
    freshness("paths", { paths: ["apps/web/**"] }),
  ],
  ["paths: head already contains the tip", behind(0), [], freshness("paths", { paths: ["**"] })],
  [
    "comparison unavailable blocks without being actionable",
    { baseComparison: null },
    ["base_unknown"],
    freshness("contains-tip"),
  ],
  [
    "closed PRs skip the rule",
    { state: "MERGED", ...behind(5) },
    ["closed"],
    freshness("contains-tip"),
  ],
]);

describe("base freshness detail", () => {
  test("stale evaluation records behind count and touched paths", () => {
    const evaluation = evaluateSnapshot(
      behind(2, ["budgets/bundle.json", "docs/x.md"]),
      freshness("paths", { paths: ["budgets/*.json"] }),
    );
    expect(evaluation.base).toEqual({
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      behindBy: 2,
      touched: ["budgets/bundle.json"],
      stale: true,
      policy: "paths",
    });
    const [firstReason] = evaluation.reasons;
    expect(firstReason?.detail).toContain("budgets/bundle.json");
    expect(evaluation.awaitingHuman).toBe(false);
  });
});
