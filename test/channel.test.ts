import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelContent, channelMeta, monitorLine } from "../src/channel/meta.ts";
import { handleRpc, negotiate, SUPPORTED_PROTOCOLS } from "../src/channel/mcp.ts";
import { LogTailer } from "../src/channel/tail.ts";
import { channelLoaded, inScope, monitorShouldEmit } from "../src/channel/scope.ts";
import type { LoggedTransition, TransitionKind } from "../src/core/types.ts";

const base: LoggedTransition = {
  id: 42,
  ts: "2026-10-06T00:00:00.000Z",
  kind: "ready",
  repo: "acme/widgets",
  number: 7,
  head: "1111111111111111111111111111111111111111",
  reason: "all readiness rules pass",
  data: {},
  title: "Tidy the widget loader",
  url: "https://github.com/acme/widgets/pull/7",
};
const t = (kind: TransitionKind, data: Record<string, unknown> = {}, reason = "r"): LoggedTransition => ({ ...base, kind, data, reason });

describe("channel meta", () => {
  test.each<[TransitionKind, Record<string, unknown>, Record<string, string>]>([
    ["checks_failed", { names: ["build", "lint"], required: ["build"] }, { failed: "build,lint", required_failed: "build" }],
    ["review_scored", { bot: "greptile", score: 3, maxScore: 5, minScore: 4, head: "abc", onHead: true, meetsThreshold: false }, { bot: "greptile", score: "3", max_score: "5", min_score: "4", reviewed_head: "abc", on_head: "true", meets_threshold: "false" }],
    ["threads_open", { count: 2, previous: 0 }, { count: "2" }],
    ["stale_base", { base: "main", baseSha: "bbb", behindBy: 4, touched: ["a.ts"], policy: "contains-tip" }, { base: "main", base_sha: "bbb", behind_by: "4", touched: "a.ts", policy: "contains-tip" }],
    ["head_moved", { from: "a", to: "b" }, { from: "a", to: "b" }],
    ["approved_on_head", { by: ["r1", "r2"] }, { by: "r1,r2" }],
    ["not_ready", { reasons: [{ code: "conflict", detail: "x" }, { code: "threads_open", detail: "y" }] }, { reasons: "conflict,threads_open" }],
    ["merge_attempted", { method: "squash", ok: false, error: "nope" }, { method: "squash", ok: "false", error: "nope" }],
    ["ready", { mergeableNow: true }, { mergeable_now: "true" }],
  ])("%s", (kind, data, extra) => {
    const meta = channelMeta(t(kind, data));
    expect(meta).toMatchObject({ kind, repo: "acme/widgets", pr: "7", head: base.head!, transition_id: "42", url: base.url, ...extra });
    for (const [k, v] of Object.entries(meta)) {
      expect(k).toMatch(/^[A-Za-z0-9_]+$/);
      expect(typeof v).toBe("string");
    }
  });

  test("content is a factual one-liner with the PR link", () => {
    expect(channelContent(t("conflicted", {}, "conflicts with main"))).toBe("acme/widgets#7 conflicted: conflicts with main (Tidy the widget loader) https://github.com/acme/widgets/pull/7");
  });

  test("monitor line carries kind, pr, short head and reason on one line", () => {
    expect(monitorLine(t("checks_failed", {}, "required failed: build (FAILURE)\nsecond line"))).toBe(
      "pr-autopilot acme/widgets#7 checks_failed head=1111111: required failed: build (FAILURE) second line https://github.com/acme/widgets/pull/7",
    );
  });
});

describe("mcp protocol negotiation", () => {
  test.each([
    ["the revision that disables channels is never echoed", "2026-07-28", SUPPORTED_PROTOCOLS[0]],
    ["a supported revision is echoed", "2025-03-26", "2025-03-26"],
    ["the oldest supported revision", "2024-11-05", "2024-11-05"],
    ["garbage falls back to the newest supported", 7, SUPPORTED_PROTOCOLS[0]],
  ] as const)("%s", (_l, requested, expected) => {
    expect(negotiate(requested)).toBe(expected!);
  });

  test("SUPPORTED never includes 2026-07-28", () => {
    expect(SUPPORTED_PROTOCOLS).not.toContain("2026-07-28");
  });
});

describe("mcp message handling", () => {
  const info = { name: "pr-autopilot", version: "0.1.0", instructions: "react with the playbook" };

  test("initialize declares the claude/channel capability and instructions", () => {
    const r = handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code" } } }, info);
    expect(r.response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { experimental: { "claude/channel": {} } },
        serverInfo: { name: "pr-autopilot", version: "0.1.0" },
        instructions: "react with the playbook",
      },
    });
  });

  test.each([
    ["initialized notification flips the ready flag", { jsonrpc: "2.0", method: "notifications/initialized" }, undefined, true],
    ["ping answers with an empty result", { jsonrpc: "2.0", id: 2, method: "ping" }, { jsonrpc: "2.0", id: 2, result: {} }, false],
    ["unknown request is method-not-found", { jsonrpc: "2.0", id: 3, method: "tools/list" }, { jsonrpc: "2.0", id: 3, error: { code: -32601, message: "method not found: tools/list" } }, false],
    ["unknown notification is ignored", { jsonrpc: "2.0", method: "notifications/cancelled" }, undefined, false],
  ] as const)("%s", (_l, msg, response, initialized) => {
    const r = handleRpc(msg, info);
    expect(r.response).toEqual(response as any);
    expect(!!r.initialized).toBe(initialized);
  });
});

describe("log tailer", () => {
  function setup(content = "") {
    const path = join(mkdtempSync(join(tmpdir(), "apl-tail-")), "transitions.jsonl");
    writeFileSync(path, content);
    const lines: string[] = [];
    const tailer = new LogTailer(path, (l) => lines.push(l), { watch: false });
    return { path, lines, tailer };
  }

  test("starts at the end so old transitions are not replayed", () => {
    const s = setup('{"id":1}\n');
    s.tailer.start();
    appendFileSync(s.path, '{"id":2}\n');
    s.tailer.poll();
    expect(s.lines).toEqual(['{"id":2}']);
  });

  test("holds a partial line until it is complete", () => {
    const s = setup();
    s.tailer.start();
    appendFileSync(s.path, '{"id":3');
    s.tailer.poll();
    expect(s.lines).toEqual([]);
    appendFileSync(s.path, '}\n{"id":4}\n');
    s.tailer.poll();
    expect(s.lines).toEqual(['{"id":3}', '{"id":4}']);
  });

  test("a truncated file is read again from the start", () => {
    const s = setup('{"id":1}\n{"id":2}\n');
    s.tailer.start();
    truncateSync(s.path, 0);
    appendFileSync(s.path, '{"id":9}\n');
    s.tailer.poll();
    expect(s.lines).toEqual(['{"id":9}']);
  });

  test("a missing file is picked up once it appears", () => {
    const dir = mkdtempSync(join(tmpdir(), "apl-tail-"));
    const path = join(dir, "transitions.jsonl");
    const lines: string[] = [];
    const tailer = new LogTailer(path, (l) => lines.push(l), { watch: false });
    tailer.start();
    writeFileSync(path, '{"id":1}\n');
    tailer.poll();
    expect(lines).toEqual(['{"id":1}']);
  });
});

describe("delivery scope", () => {
  test.each([
    ["no config delivers everything", null, "acme/widgets", true],
    ["repo in config", ["Acme/Widgets"], "acme/widgets", true],
    ["repo outside config", ["acme/other"], "acme/widgets", false],
  ] as const)("%s", (_l, repos, repo, expected) => {
    expect(inScope({ ...base, repo }, { repos: repos ? [...repos] : null })).toBe(expected);
  });

  test.each([
    ["dev channel flag naming the plugin", ["claude --dangerously-load-development-channels plugin:pr-autopilot@pr-autopilot"], true],
    ["approved channels flag naming the plugin", ["/usr/local/bin/claude --channels plugin:pr-autopilot@team"], true],
    ["dev channel flag for another plugin", ["claude --dangerously-load-development-channels plugin:fakechat@x"], false],
    ["plain session", ["claude", "zsh"], false],
    ["flag on an ancestor further up", ["sh -c pr-autopilot watch", "node claude --dangerously-load-development-channels server:pr-autopilot"], true],
  ] as const)("channelLoaded: %s", (_l, args, expected) => {
    expect(channelLoaded([...args])).toBe(expected);
  });

  test.each([
    ["off never emits", "off", true, false, false],
    ["always emits even with the channel loaded", "always", true, true, true],
    ["auto emits when the channel is not loaded", "auto", true, false, true],
    ["auto stands down when the channel is loaded", "auto", true, true, false],
    ["auto emits when the channel is disabled in config", "auto", false, true, true],
  ] as const)("monitor: %s", (_l, mode, channelEnabled, loaded, expected) => {
    expect(monitorShouldEmit(mode, channelEnabled, loaded)).toBe(expected);
  });
});
