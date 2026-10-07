import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TRANSITION_KINDS } from "../src/core/types.ts";

interface PluginManifest {
  mcpServers: Record<string, { args: string[]; env: Record<string, string> }>;
  channels: unknown[];
}

interface HookEntry {
  hooks: Array<{ command: string }>;
}

interface HooksManifest {
  hooks: Record<string, HookEntry[]>;
}

interface Monitor {
  when: string;
  command: string;
}

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}"?\/([^\s"]+)/u;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/u;

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const readJson = <Shape>(path: string) => JSON.parse(read(path)) as Shape;

function entryExists(command: string) {
  const [, path] = PLUGIN_PATH.exec(command) ?? [];
  return path !== undefined && existsSync(join(ROOT, path));
}

function frontmatter(markdown: string) {
  const [, yaml] = FRONTMATTER.exec(markdown) ?? [];
  return yaml === undefined ? {} : (Bun.YAML.parse(yaml) as Record<string, unknown>);
}

const hookCommands = (entries: HookEntry[]) =>
  entries.flatMap((entry) => entry.hooks.map((hook) => hook.command));

describe("plugin packaging", () => {
  test("manifest wires the channel server with legacy protocol negotiation", () => {
    const manifest = readJson<PluginManifest>(".claude-plugin/plugin.json");
    const server = manifest.mcpServers["pr-autopilot"];
    expect(server?.env.MCP_PROTOCOL_NEGOTIATION).toBe("legacy");
    expect(entryExists(server?.args[0] ?? "")).toBe(true);
    expect(manifest.channels).toEqual([
      { server: "pr-autopilot", displayName: "PR autopilot transitions" },
    ]);
  });

  test("marketplace lists the plugin at the repo root", () => {
    const marketplace = readJson<{ plugins: unknown[] }>(".claude-plugin/marketplace.json");
    expect(marketplace.plugins[0]).toMatchObject({ name: "pr-autopilot", source: "./" });
  });

  test("hooks call existing entry points", () => {
    const { hooks } = readJson<HooksManifest>("hooks/hooks.json");
    expect(Object.keys(hooks)).toEqual(["SessionStart", "Stop"]);
    for (const entries of Object.values(hooks)) {
      for (const command of hookCommands(entries.slice(0, 1))) {
        expect(entryExists(command)).toBe(true);
      }
    }
    expect(hooks.SessionStart?.[0]?.hooks[0]?.command).toEndWith("hook session-start");
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toEndWith("hook stop");
  });

  test("monitor starts always and runs watch", () => {
    const [monitor] = readJson<Monitor[]>("monitors/monitors.json");
    expect(monitor?.when).toBe("always");
    expect(monitor?.command).toEndWith("bin/pr-autopilot watch");
  });

  test("/ship is user-invoked only and injects project context", () => {
    const markdown = read("skills/ship/SKILL.md");
    expect(frontmatter(markdown)).toMatchObject({
      name: "ship",
      "disable-model-invocation": true,
    });
    expect(markdown).toContain('!`"${CLAUDE_PLUGIN_ROOT}/bin/pr-autopilot" ship-context`');
  });

  test("the playbook covers every transition kind", () => {
    const markdown = read("skills/pr-autopilot/SKILL.md");
    expect(frontmatter(markdown).name).toBe("pr-autopilot");
    const missing = TRANSITION_KINDS.filter((kind) => !markdown.includes(`\`${kind}\``));
    expect(missing).toEqual([]);
  });
});
