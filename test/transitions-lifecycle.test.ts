import { HEAD, HEAD2 } from "./fixtures/build.ts";
import { transitionTable } from "./fixtures/transition-table.ts";

const behind = (behindBy: number) => ({ behindBy, files: [], truncated: false });
const MOVED_BASE = "c".repeat(40);

transitionTable(
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

transitionTable(
  "transition: head moved",
  ["head_moved"],
  [
    ["same head", {}, {}, []],
    ["new head", { headSha: HEAD }, { headSha: HEAD2 }, ["head_moved"]],
    ["first sight is not a move", null, { headSha: HEAD2 }, []],
  ],
);

transitionTable(
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

transitionTable(
  "transition: stale base",
  ["stale_base"],
  [
    ["base tip contained", {}, {}, []],
    [
      "base moves past head",
      {},
      { baseSha: MOVED_BASE, baseComparison: behind(2) },
      ["stale_base"],
    ],
    [
      "still stale on same head and base",
      { baseComparison: behind(2) },
      { baseComparison: behind(2) },
      [],
    ],
    [
      "base moves again while stale",
      { baseComparison: behind(2) },
      { baseSha: MOVED_BASE, baseComparison: behind(3) },
      ["stale_base"],
    ],
    [
      "new head still behind",
      { baseComparison: behind(2) },
      { headSha: HEAD2, baseComparison: behind(1) },
      ["stale_base"],
    ],
    [
      "merge of base clears it silently",
      { baseComparison: behind(2) },
      { headSha: HEAD2, baseComparison: behind(0) },
      [],
    ],
  ],
);
