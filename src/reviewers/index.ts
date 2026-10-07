import { isAbsolute, resolve } from "node:path";
import type { ReviewerConfig } from "../config/schema.ts";
import type { ReviewerParser } from "./types.ts";
import { greptile } from "./greptile.ts";
import { regexParser } from "./regex.ts";

export const BUILTIN_PARSERS: Record<string, ReviewerParser> = {
  [greptile.id]: greptile,
  [regexParser.id]: regexParser,
};

const normLogin = (l: string) => l.toLowerCase().replace(/\[bot\]$/, "");

export function loginMatches(login: string | null, logins: string[]) {
  if (!login) return false;
  const n = normLogin(login);
  return logins.some((l) => normLogin(l) === n);
}

export async function loadParsers(reviewers: ReviewerConfig[], baseDir = process.cwd()) {
  const out = new Map<string, ReviewerParser>();
  for (const r of reviewers) {
    let parser = BUILTIN_PARSERS[r.parser];
    if (!parser) {
      if (!r.parser.startsWith(".") && !isAbsolute(r.parser)) throw new Error(`unknown reviewer parser "${r.parser}" for ${r.name}`);
      const mod = await import(resolve(baseDir, r.parser));
      parser = (mod.default ?? mod.parser) as ReviewerParser;
      if (!parser || typeof parser.parse !== "function") throw new Error(`${r.parser} does not export a reviewer parser`);
    }
    parser.validate?.(r.options);
    out.set(r.name, parser);
  }
  return out;
}
