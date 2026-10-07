import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TRANSITION_KINDS } from "../src/core/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(read(p));
const pluginPath = (cmd: string) => /\$\{CLAUDE_PLUGIN_ROOT\}"?\/([^\s"]+)/.exec(cmd)?.[1];

function frontmatter(md: string) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  return m ? (Bun.YAML.parse(m[1]!) as Record<string, unknown>) : {};
}

describe("plugin packaging", () => {
  test("manifest wires the channel server with legacy protocol negotiation", () => {
    const m = json(".claude-plugin/plugin.json");
    const server = m.mcpServers["pr-autopilot"];
    expect(server.env.MCP_PROTOCOL_NEGOTIATION).toBe("legacy");
    expect(existsSync(join(ROOT, pluginPath(server.args[0])!))).toBe(true);
    expect(m.channels).toEqual([
      { server: "pr-autopilot", displayName: "PR autopilot transitions" },
    ]);
  });

  test("marketplace lists the plugin at the repo root", () => {
    expect(json(".claude-plugin/marketplace.json").plugins[0]).toMatchObject({
      name: "pr-autopilot",
      source: "./",
    });
  });

  test("hooks call existing entry points", () => {
    const h = json("hooks/hooks.json").hooks;
    expect(Object.keys(h)).toEqual(["SessionStart", "Stop"]);
    for (const event of Object.values<any>(h)) {
      for (const cmd of event[0].hooks.map((x: any) => x.command))
        expect(existsSync(join(ROOT, pluginPath(cmd)!))).toBe(true);
    }
    expect(h.SessionStart[0].hooks[0].command).toEndWith("hook session-start");
    expect(h.Stop[0].hooks[0].command).toEndWith("hook stop");
  });

  test("monitor starts always and runs watch", () => {
    const [mon] = json("monitors/monitors.json");
    expect(mon.when).toBe("always");
    expect(mon.command).toEndWith("bin/pr-autopilot watch");
  });

  test("/ship is user-invoked only and injects project context", () => {
    const md = read("skills/ship/SKILL.md");
    expect(frontmatter(md)).toMatchObject({ name: "ship", "disable-model-invocation": true });
    expect(md).toContain('!`"${CLAUDE_PLUGIN_ROOT}/bin/pr-autopilot" ship-context`');
  });

  test("the playbook covers every transition kind", () => {
    const md = read("skills/pr-autopilot/SKILL.md");
    expect(frontmatter(md).name).toBe("pr-autopilot");
    const missing = TRANSITION_KINDS.filter((k) => !md.includes(`\`${k}\``));
    expect(missing).toEqual([]);
  });
});
