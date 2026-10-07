import { isAbsolute, resolve } from "node:path";
import { ghForwardFactory } from "./gh-webhook-forward.ts";
import { replayFactory } from "./replay.ts";
import type { EventSource, SourceDeps, SourceFactory } from "./types.ts";

export const BUILTIN_SOURCES: Record<string, SourceFactory> = {
  "gh-webhook-forward": ghForwardFactory,
  replay: replayFactory,
};

export async function createSource(type: string, options: Record<string, unknown>, deps: SourceDeps): Promise<EventSource> {
  let factory = BUILTIN_SOURCES[type];
  if (!factory) {
    if (!type.startsWith(".") && !isAbsolute(type)) throw new Error(`unknown event source "${type}"`);
    const mod = await import(resolve(deps.baseDir, type));
    factory = (mod.default ?? mod.createSource) as SourceFactory;
    if (typeof factory !== "function") throw new Error(`${type} does not export an event source factory`);
  }
  return factory(options, deps);
}
