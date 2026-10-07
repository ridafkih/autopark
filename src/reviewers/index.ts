import { isAbsolute, resolve } from "node:path";
import type { ReviewerConfig } from "../config/schema.ts";
import { greptile } from "./greptile.ts";
import { regexParser } from "./regex.ts";
import type { ReviewerParser } from "./types.ts";

export const BUILTIN_PARSERS: Record<string, ReviewerParser> = {
  [greptile.id]: greptile,
  [regexParser.id]: regexParser,
};

const normalizeLogin = (login: string) => login.toLowerCase().replace(/\[bot\]$/u, "");

const isModulePath = (specifier: string) => specifier.startsWith(".") || isAbsolute(specifier);

export function loginMatches(login: string | null, logins: string[]) {
  if (!login) return false;
  const normalized = normalizeLogin(login);
  return logins.some((candidate) => normalizeLogin(candidate) === normalized);
}

async function importParser(reviewer: ReviewerConfig, baseDir: string) {
  if (!isModulePath(reviewer.parser)) {
    throw new Error(`unknown reviewer parser "${reviewer.parser}" for ${reviewer.name}`);
  }
  const imported: Record<string, unknown> = await import(resolve(baseDir, reviewer.parser));
  const parser = (imported.default ?? imported.parser) as ReviewerParser | undefined;
  if (!parser || typeof parser.parse !== "function") {
    throw new Error(`${reviewer.parser} does not export a reviewer parser`);
  }
  return parser;
}

export async function loadParsers(reviewers: ReviewerConfig[], baseDir = process.cwd()) {
  const parsers = new Map<string, ReviewerParser>();
  for (const reviewer of reviewers) {
    const parser = BUILTIN_PARSERS[reviewer.parser] ?? (await importParser(reviewer, baseDir));
    parser.validate?.(reviewer.options);
    parsers.set(reviewer.name, parser);
  }
  return parsers;
}
