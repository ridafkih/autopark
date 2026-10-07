import { describe, expect, test } from "bun:test";
import { parseConfig, configJsonSchema } from "../src/config/schema.ts";
import { loadConfigFile, parseConfigText } from "../src/config/load.ts";

const minimal = { repos: ["acme/widgets"] };

describe("config defaults", () => {
  test("minimal config fills every section", () => {
    const r = parseConfig(minimal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.config;
    expect(c.repos).toEqual(["acme/widgets"]);
    expect(c.track).toEqual({ authors: [], branchPrefixes: [], labels: [] });
    expect(c.checks.useGitHubRequired).toBe(true);
    expect(c.checks.required).toEqual([]);
    expect(c.checks.humanGates).toEqual([]);
    expect(c.reviewers).toEqual([]);
    expect(c.readiness.approvalOnHead).toBe(true);
    expect(c.readiness.minApprovals).toBe(1);
    expect(c.readiness.noConflict).toBe(true);
    expect(c.readiness.noUnresolvedThreads).toBe(true);
    expect(c.autoMerge.method).toBe("squash");
    expect(c.autoMerge.default).toBe(false);
    expect(c.delivery).toEqual({ channel: true, monitor: "auto", playbook: null });
    expect(c.hooks.stop.enabled).toBe(true);
    expect(c.hooks.stop.maxBlocks).toBe(3);
    expect(c.daemon.backoffMs).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(c.daemon.source.type).toBe("gh-webhook-forward");
  });

  test("reviewer defaults are applied per entry", () => {
    const r = parseConfig({ ...minimal, reviewers: [{ name: "greptile", parser: "greptile" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.reviewers[0]).toEqual({
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
    const a = parseConfig(minimal);
    const b = parseConfig(minimal);
    if (!a.ok || !b.ok) throw new Error("unexpected");
    a.config.track.labels.push("x");
    expect(b.config.track.labels).toEqual([]);
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
  ["fractional approvals", { ...minimal, readiness: { minApprovals: 1.5 } }, "readiness.minApprovals"],
  ["bad merge method", { ...minimal, autoMerge: { method: "fast-forward" } }, "autoMerge.method"],
  ["reviewer without parser", { ...minimal, reviewers: [{ name: "x" }] }, "reviewers[0].parser"],
  ["reviewer bad name", { ...minimal, reviewers: [{ name: "Bad Name", parser: "regex" }] }, "reviewers[0].name"],
  ["notify target without command", { ...minimal, notify: [{ type: "command" }] }, "notify[0].command"],
  ["notify on unknown kind", { ...minimal, notify: [{ type: "command", command: "x", on: ["exploded"] }] }, "notify[0].on[0]"],
  ["stop scope invalid", { ...minimal, hooks: { stop: { scope: "everyone" } } }, "hooks.stop.scope"],
  ["empty backoff", { ...minimal, daemon: { backoffMs: [] } }, "daemon.backoffMs"],
  ["port out of range", { ...minimal, daemon: { port: 70000 } }, "daemon.port"],
  ["boolean as string", { ...minimal, delivery: { channel: "yes" } }, "delivery.channel"],
  ["monitor mode invalid", { ...minimal, delivery: { monitor: true } }, "delivery.monitor"],
  ["source with empty type", { ...minimal, daemon: { source: { type: "" } } }, "daemon.source.type"],
];

describe("config validation rejects", () => {
  test.each(invalid)("%s", (_label, input, path) => {
    const r = parseConfig(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.path)).toContain(path);
  });
});

const valid: Array<[string, unknown]> = [
  ["minimal", minimal],
  ["track filters", { ...minimal, track: { authors: ["@me"], branchPrefixes: ["bot/"], labels: ["autopilot"] } }],
  ["explicit required checks", { ...minimal, checks: { useGitHubRequired: false, required: ["build"], humanGates: ["gate"], ignore: ["noise"] } }],
  ["regex reviewer", { ...minimal, reviewers: [{ name: "rabbit", parser: "regex", logins: ["coderabbitai"], minScore: 4, options: { score: "Score: (\\d+)" } }] }],
  ["notify command", { ...minimal, notify: [{ type: "command", command: "echo hi", on: ["ready", "conflicted"] }] }],
  ["auto merge by label", { ...minimal, autoMerge: { labels: ["automerge"], method: "rebase" } }],
  ["review request command", { ...minimal, reviewRequest: { command: "notify-reviewers $PR_AUTOPILOT_URL" } }],
  ["replay source", { ...minimal, daemon: { source: { type: "replay", options: { file: "x.jsonl" } } } }],
  ["hooks disabled", { ...minimal, hooks: { sessionStart: { enabled: false }, stop: { enabled: false } } }],
];

describe("config validation accepts", () => {
  test.each(valid)("%s", (_label, input) => {
    const r = parseConfig(input);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.ok).toBe(true);
  });
});

describe("config files", () => {
  test("yaml and json parse to the same config", () => {
    const yaml = parseConfigText("repos:\n  - acme/widgets\nreadiness:\n  minApprovals: 2\n", "x.yaml");
    const json = parseConfigText('{"repos":["acme/widgets"],"readiness":{"minApprovals":2}}', "x.json");
    expect(yaml).toEqual(json);
  });

  test("shipped example configs are valid", async () => {
    for (const name of ["examples/minimal.pr-autopilot.yaml", "examples/ando.pr-autopilot.yaml"]) {
      const r = await loadConfigFile(`${import.meta.dir}/../${name}`);
      if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.issues)}`);
    }
  });

  test("json schema is generated from the same definition", () => {
    const schema = configJsonSchema() as any;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["repos"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.autoMerge.properties.method.enum).toEqual(["merge", "squash", "rebase"]);
    expect(schema.properties.daemon.properties.backoffMs.default).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
  });
});
