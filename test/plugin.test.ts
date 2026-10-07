import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { arrayAt, isRecord, parseJson, recordsAt, stringAt, valueAt } from "../src/core/json.ts";
import { TRANSITION_KINDS } from "../src/core/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}"?\/([^\s"]+)/u;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/u;

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const readJson = (path: string) => parseJson(read(path));

function entryExists(command: string) {
  const [, path] = PLUGIN_PATH.exec(command) ?? [];
  return path !== undefined && existsSync(join(ROOT, path));
}

function frontmatter(markdown: string) {
  const [, yaml] = FRONTMATTER.exec(markdown) ?? [];
  const parsed: unknown = yaml === undefined ? {} : Bun.YAML.parse(yaml);
  return isRecord(parsed) ? parsed : {};
}

const firstHookCommands = (entries: unknown) =>
  recordsAt(entries, "hooks").flatMap((hook) => {
    const command = stringAt(hook, "command");
    return command === undefined ? [] : [command];
  });

describe("plugin packaging", () => {
  test("manifest wires the channel server with legacy protocol negotiation", () => {
    const manifest = readJson(".claude-plugin/plugin.json");
    const server = valueAt(manifest, "mcpServers", "autopark");
    expect(stringAt(server, "env", "MCP_PROTOCOL_NEGOTIATION")).toBe("legacy");
    const [entry] = arrayAt(server, "args");
    expect(entryExists(String(entry))).toBe(true);
    expect(valueAt(manifest, "channels")).toEqual([
      { server: "autopark", displayName: "Autopark transitions" },
    ]);
  });

  test("marketplace lists the plugin at the repo root", () => {
    const [plugin] = arrayAt(readJson(".claude-plugin/marketplace.json"), "plugins");
    expect(plugin).toMatchObject({ name: "autopark", source: "./" });
  });

  test("hooks call existing entry points", () => {
    const hooks = valueAt(readJson("hooks/hooks.json"), "hooks");
    expect(Object.keys(isRecord(hooks) ? hooks : {})).toEqual(["SessionStart", "Stop"]);
    const sessionStart = firstHookCommands(arrayAt(hooks, "SessionStart")[0]);
    const stop = firstHookCommands(arrayAt(hooks, "Stop")[0]);
    for (const command of [...sessionStart, ...stop]) expect(entryExists(command)).toBe(true);
    expect(sessionStart[0]).toEndWith("hook session-start");
    expect(stop[0]).toEndWith("hook stop");
  });

  test("monitor starts always and runs watch", () => {
    const monitors = readJson("monitors/monitors.json");
    const [monitor] = Array.isArray(monitors) ? monitors : [];
    expect(stringAt(monitor, "when")).toBe("always");
    expect(stringAt(monitor, "command")).toEndWith("bin/autopark watch");
  });

  test("/ship is user-invoked only and injects project context", () => {
    const markdown = read("skills/ship/SKILL.md");
    expect(frontmatter(markdown)).toMatchObject({
      name: "ship",
      "disable-model-invocation": true,
    });
    expect(markdown).toContain('!`"${CLAUDE_PLUGIN_ROOT}/bin/autopark" ship-context`');
  });

  test("the playbook covers every transition kind", () => {
    const markdown = read("skills/autopark/SKILL.md");
    expect(frontmatter(markdown).name).toBe("autopark");
    const missing = TRANSITION_KINDS.filter((kind) => !markdown.includes(`\`${kind}\``));
    expect(missing).toEqual([]);
  });
});
