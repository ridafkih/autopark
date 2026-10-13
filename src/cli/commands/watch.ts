import { cwdConfig } from "../../channel/context.ts";
import { monitorLine } from "../../channel/meta.ts";
import {
  ancestorArgs,
  channelLoaded,
  deliveryScope,
  inScope,
  monitorShouldEmit,
  type DeliveryScope,
} from "../../channel/scope.ts";
import { LogTailer } from "../../channel/tail.ts";
import type { Config } from "../../config/schema.ts";
import { errorMessage } from "../../core/errors.ts";
import { sessionIdFrom } from "../../core/session.ts";
import { parseLoggedTransition } from "../../core/transition-codec.ts";
import type { Invocation } from "./types.ts";

const waitForever = () => new Promise<never>(() => {});

function shouldEmit(config: Config | null) {
  const mode = config?.delivery.monitor ?? "auto";
  const isLoaded = mode === "auto" ? channelLoaded(ancestorArgs()) : false;
  return { mode, isEmitting: monitorShouldEmit(mode, config?.delivery.channel ?? true, isLoaded) };
}

function printInScope(line: string, scope: DeliveryScope) {
  const transition = parseLoggedTransition(line);
  try {
    if (transition && inScope(transition, scope)) {
      process.stdout.write(`${monitorLine(transition)}\n`);
    }
  } catch (error) {
    process.stderr.write(`autopark watch: skipped a transition: ${errorMessage(error)}\n`);
  }
}

export async function watchTransitions({ paths }: Invocation) {
  const { config } = await cwdConfig(process.cwd());
  const { mode, isEmitting } = shouldEmit(config);
  if (!isEmitting) {
    const reason = mode === "auto" ? ", channel loaded" : "";
    process.stderr.write(`autopark watch: silent (monitor=${mode}${reason})\n`);
    await waitForever();
  }
  const scope = deliveryScope(config?.repos ?? [], sessionIdFrom(process.env), paths.db);
  new LogTailer(paths.log, (line) => printInScope(line, scope)).start();
  process.stderr.write(`autopark watch: tailing ${paths.log}\n`);
  await waitForever();
}
