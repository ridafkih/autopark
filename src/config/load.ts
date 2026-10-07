import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { parseConfig, type ParseResult } from "./schema.ts";

export const CONFIG_NAMES = [".pr-autopilot.yaml", ".pr-autopilot.yml", ".pr-autopilot.json"];

export function parseConfigText(text: string, filename: string): unknown {
  if (filename.endsWith(".json")) return JSON.parse(text);
  return Bun.YAML.parse(text);
}

export async function loadConfigFile(path: string): Promise<ParseResult & { path: string }> {
  const text = await Bun.file(path).text();
  let raw: unknown;
  try {
    raw = parseConfigText(text, path);
  } catch (e) {
    return { ok: false, issues: [{ path: "(file)", message: (e as Error).message }], path };
  }
  return { ...parseConfig(raw), path };
}

export function findConfig(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
