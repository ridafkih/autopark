import { cwdConfig } from "../../channel/context.ts";
import {
  codeStamp,
  liveDeliveries,
  removeHeartbeat,
  writeHeartbeat,
} from "../../channel/heartbeat.ts";
import { monitorLine } from "../../channel/meta.ts";
import {
  deliveryScope,
  inScope,
  monitorShouldEmit,
  type DeliveryScope,
} from "../../channel/scope.ts";
import { LogTailer } from "../../channel/tail.ts";
import type { Config } from "../../config/schema.ts";
import type { Paths } from "../../daemon/paths.ts";
import { errorMessage } from "../../core/errors.ts";
import { sessionIdFrom } from "../../core/session.ts";
import { parseLoggedTransition } from "../../core/transition-codec.ts";
import type { Invocation } from "./types.ts";

const PARENT_CHECK_MS = 5000;

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

function untilOrphaned() {
  return new Promise<void>((resolve) => {
    const parent = process.ppid;
    const timer = setInterval(() => {
      if (process.ppid === parent && process.ppid !== 1) return;
      clearInterval(timer);
      resolve();
    }, PARENT_CHECK_MS);
    process.stdout.on("error", () => {
      clearInterval(timer);
      resolve();
    });
  });
}

const isChannelLive = (paths: Paths, sessionId: string | null) =>
  sessionId !== null &&
  liveDeliveries(paths, { sessionId, stamp: codeStamp() }).some(
    (heartbeat) => heartbeat.kind === "channel",
  );

export const FALLBACK_FLAG = "--fallback";

function deliveryOf(paths: Paths, config: Config | null, argv: string[]) {
  const mode = argv.includes(FALLBACK_FLAG) ? "auto" : (config?.delivery.monitor ?? "auto");
  const isChannelEnabled = config?.delivery.channel ?? true;
  const sessionId = sessionIdFrom(process.env);
  const shouldEmit = () =>
    monitorShouldEmit(mode, isChannelEnabled, mode === "auto" && isChannelLive(paths, sessionId));
  return { mode, sessionId, shouldEmit };
}

function forwardLine(line: string, scope: DeliveryScope, delivery: ReturnType<typeof deliveryOf>) {
  if (delivery.shouldEmit()) {
    printInScope(line, scope);
    return;
  }
  if (delivery.mode === "auto") {
    process.stderr.write("autopark watch: a live channel delivered this transition\n");
  }
}

export async function watchTransitions({ argv, paths }: Invocation) {
  const stamp = codeStamp();
  const { config } = await cwdConfig(process.cwd());
  const delivery = deliveryOf(paths, config, argv);
  const { mode, sessionId } = delivery;
  const scope = deliveryScope(config?.repos ?? [], sessionId, paths.db);
  const tailer = new LogTailer(paths.log, (line) => forwardLine(line, scope, delivery));
  tailer.start();
  if (sessionId && mode !== "off") {
    const heartbeat = { kind: "monitor" as const, pid: process.pid, sessionId, stamp };
    writeHeartbeat(paths, { ...heartbeat, startedAt: Date.now() });
  }
  process.stderr.write(`autopark watch: tailing ${paths.log} (monitor=${mode})\n`);
  await untilOrphaned();
  tailer.stop();
  removeHeartbeat(paths, "monitor", process.pid);
}
