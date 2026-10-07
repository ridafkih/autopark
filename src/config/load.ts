import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { errorMessage } from "../core/errors.ts";
import { parseConfig, type ParseResult } from "./schema.ts";

export const CONFIG_NAMES = [".pr-autopilot.yaml", ".pr-autopilot.yml", ".pr-autopilot.json"];

type RawConfig = { ok: true; raw: unknown } | { ok: false; message: string };

export function parseConfigText(text: string, filename: string): unknown {
  if (filename.endsWith(".json")) return JSON.parse(text);
  return Bun.YAML.parse(text);
}

function readRawConfig(text: string, path: string): RawConfig {
  try {
    return { ok: true, raw: parseConfigText(text, path) };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function loadConfigFile(path: string): Promise<ParseResult & { path: string }> {
  const rawConfig = readRawConfig(await Bun.file(path).text(), path);
  if (!rawConfig.ok) {
    return { ok: false, issues: [{ path: "(file)", message: rawConfig.message }], path };
  }
  return { ...parseConfig(rawConfig.raw), path };
}

export function findConfig(from: string): string | null {
  const directory = resolve(from);
  const found = CONFIG_NAMES.map((name) => join(directory, name)).find((candidate) =>
    existsSync(candidate),
  );
  if (found) return found;
  const parent = dirname(directory);
  return parent === directory ? null : findConfig(parent);
}
