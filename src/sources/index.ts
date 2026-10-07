import { isAbsolute, resolve } from "node:path";
import { ghForwardFactory } from "./gh-webhook-forward.ts";
import { replayFactory } from "./replay.ts";
import type { EventSource, SourceDependencies, SourceFactory } from "./types.ts";

export const BUILTIN_SOURCES: Record<string, SourceFactory> = {
  "gh-webhook-forward": ghForwardFactory,
  replay: replayFactory,
};

async function importFactory(type: string, baseDir: string) {
  if (!type.startsWith(".") && !isAbsolute(type)) {
    throw new Error(`unknown event source "${type}"`);
  }
  const imported: Record<string, unknown> = await import(resolve(baseDir, type));
  const factory = imported.default ?? imported.createSource;
  if (typeof factory !== "function") {
    throw new TypeError(`${type} does not export an event source factory`);
  }
  return factory as SourceFactory;
}

export async function createSource(
  type: string,
  options: Record<string, unknown>,
  dependencies: SourceDependencies,
): Promise<EventSource> {
  const factory = BUILTIN_SOURCES[type] ?? (await importFactory(type, dependencies.baseDir));
  return factory(options, dependencies);
}
