import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config/schema.ts";

const minimal = { repos: ["acme/widgets"] };

describe("config defaults", () => {
  test("minimal config fills every section", () => {
    const result = parseConfig(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { config } = result;
    const expectations: Array<[unknown, unknown]> = [
      [config.repos, ["acme/widgets"]],
      [config.track, { authors: [], branchPrefixes: [], labels: [] }],
      [config.checks.useGitHubRequired, true],
      [config.checks.required, []],
      [config.checks.humanGates, []],
      [config.reviewers, []],
      [config.readiness.approvalOnHead, true],
      [config.readiness.minApprovals, 1],
      [config.readiness.noConflict, true],
      [config.readiness.noUnresolvedThreads, true],
      [config.autoMerge.method, "squash"],
      [config.autoMerge.default, false],
      [config.delivery, { channel: true, monitor: "auto", playbook: null }],
      [config.hooks.stop.enabled, true],
      [config.hooks.stop.maxBlocks, 3],
      [config.daemon.backoffMs, [1000, 2000, 4000, 8000, 16_000, 30_000]],
      [config.daemon.source.type, "gh-webhook-forward"],
    ];
    for (const [actual, expected] of expectations) expect(actual).toEqual(expected);
  });

  test("reviewer defaults are applied per entry", () => {
    const result = parseConfig({
      ...minimal,
      reviewers: [{ name: "greptile", parser: "greptile" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.reviewers[0]).toEqual({
      name: "greptile",
      parser: "greptile",
      logins: [],
      minScore: null,
      required: true,
      requireOnHead: true,
      options: {},
    });
  });

  test("defaults are not shared between parses", () => {
    const first = parseConfig(minimal);
    const second = parseConfig(minimal);
    if (!first.ok || !second.ok) throw new Error("unexpected");
    first.config.track.labels.push("x");
    expect(second.config.track.labels).toEqual([]);
  });
});

const invalid: Array<[string, unknown, string]> = [
  ["missing repos", {}, "repos"],
  ["empty repos", { repos: [] }, "repos"],
  ["bad repo slug", { repos: ["widgets"] }, "repos[0]"],
  ["repos not array", { repos: "acme/widgets" }, "repos"],
  ["unknown top-level key", { ...minimal, colour: "blue" }, "colour"],
  ["unknown nested key", { ...minimal, readiness: { minScore: 4 } }, "readiness.minScore"],
  ["negative approvals", { ...minimal, readiness: { minApprovals: -1 } }, "readiness.minApprovals"],
  [
    "fractional approvals",
    { ...minimal, readiness: { minApprovals: 1.5 } },
    "readiness.minApprovals",
  ],
  ["bad merge method", { ...minimal, autoMerge: { method: "fast-forward" } }, "autoMerge.method"],
  ["reviewer without parser", { ...minimal, reviewers: [{ name: "x" }] }, "reviewers[0].parser"],
  [
    "reviewer bad name",
    { ...minimal, reviewers: [{ name: "Bad Name", parser: "regex" }] },
    "reviewers[0].name",
  ],
  [
    "notify target without command",
    { ...minimal, notify: [{ type: "command" }] },
    "notify[0].command",
  ],
  [
    "notify on unknown kind",
    { ...minimal, notify: [{ type: "command", command: "x", on: ["exploded"] }] },
    "notify[0].on[0]",
  ],
  [
    "stop scope invalid",
    { ...minimal, hooks: { stop: { scope: "everyone" } } },
    "hooks.stop.scope",
  ],
  ["empty backoff", { ...minimal, daemon: { backoffMs: [] } }, "daemon.backoffMs"],
  ["port out of range", { ...minimal, daemon: { port: 70000 } }, "daemon.port"],
  ["boolean as string", { ...minimal, delivery: { channel: "yes" } }, "delivery.channel"],
  ["monitor mode invalid", { ...minimal, delivery: { monitor: true } }, "delivery.monitor"],
  [
    "source with empty type",
    { ...minimal, daemon: { source: { type: "" } } },
    "daemon.source.type",
  ],
];

describe("config validation rejects", () => {
  test.each(invalid)("%s", (label, input, path) => {
    const result = parseConfig(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });
});

const valid: Array<[string, unknown]> = [
  ["minimal", minimal],
  [
    "track filters",
    { ...minimal, track: { authors: ["@me"], branchPrefixes: ["bot/"], labels: ["autopilot"] } },
  ],
  [
    "explicit required checks",
    {
      ...minimal,
      checks: {
        useGitHubRequired: false,
        required: ["build"],
        humanGates: ["gate"],
        ignore: ["noise"],
      },
    },
  ],
  [
    "regex reviewer",
    {
      ...minimal,
      reviewers: [
        {
          name: "rabbit",
          parser: "regex",
          logins: ["coderabbitai"],
          minScore: 4,
          options: { score: "Score: (\\d+)" },
        },
      ],
    },
  ],
  [
    "notify command",
    { ...minimal, notify: [{ type: "command", command: "echo hi", on: ["ready", "conflicted"] }] },
  ],
  ["auto merge by label", { ...minimal, autoMerge: { labels: ["automerge"], method: "rebase" } }],
  [
    "review request command",
    { ...minimal, reviewRequest: { command: "notify-reviewers $PR_AUTOPILOT_URL" } },
  ],
  [
    "replay source",
    { ...minimal, daemon: { source: { type: "replay", options: { file: "x.jsonl" } } } },
  ],
  [
    "hooks disabled",
    { ...minimal, hooks: { sessionStart: { enabled: false }, stop: { enabled: false } } },
  ],
];

describe("config validation accepts", () => {
  test.each(valid)("%s", (label, input) => {
    const result = parseConfig(input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.ok).toBe(true);
  });
});
