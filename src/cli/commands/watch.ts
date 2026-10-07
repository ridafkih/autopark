import { cwdConfig } from "../../channel/context.ts";
import { monitorLine } from "../../channel/meta.ts";
import {
  ancestorArgs,
  channelLoaded,
  inScope,
  monitorShouldEmit,
  type DeliveryScope,
} from "../../channel/scope.ts";
import { LogTailer } from "../../channel/tail.ts";
import type { Config } from "../../config/schema.ts";
import type { LoggedTransition } from "../../core/types.ts";
import type { Invocation } from "./types.ts";

const waitForever = () => new Promise<never>(() => {});

function parseTransition(line: string): LoggedTransition | null {
  try {
    return JSON.parse(line) as LoggedTransition;
  } catch {
    return null;
  }
}

function shouldEmit(config: Config | null) {
  const mode = config?.delivery.monitor ?? "auto";
  const isLoaded = mode === "auto" ? channelLoaded(ancestorArgs()) : false;
  return { mode, isEmitting: monitorShouldEmit(mode, config?.delivery.channel ?? true, isLoaded) };
}

function printInScope(line: string, scope: DeliveryScope) {
  const transition = parseTransition(line);
  if (transition && inScope(transition, scope)) {
    process.stdout.write(`${monitorLine(transition)}\n`);
  }
}

export async function watchTransitions({ paths }: Invocation) {
  const { config } = await cwdConfig(process.cwd());
  const { mode, isEmitting } = shouldEmit(config);
  if (!isEmitting) {
    const reason = mode === "auto" ? ", channel loaded" : "";
    process.stderr.write(`pr-autopilot watch: silent (monitor=${mode}${reason})\n`);
    await waitForever();
  }
  const scope = { repos: config?.repos ?? null };
  new LogTailer(paths.log, (line) => printInScope(line, scope)).start();
  process.stderr.write(`pr-autopilot watch: tailing ${paths.log}\n`);
  await waitForever();
}
