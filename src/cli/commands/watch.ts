import { cwdConfig } from "../../channel/context.ts";
import { removeHeartbeat, writeHeartbeat } from "../../channel/heartbeat.ts";
import { ChannelRelay } from "../../channel/relay.ts";
import { sessionIdFrom } from "../../core/session.ts";
import type { Invocation } from "./types.ts";

const PARENT_CHECK_MS = 5000;

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

export async function watchTransitions({ paths }: Invocation) {
  const cwd = process.cwd();
  const { config } = await cwdConfig(cwd);
  const sessionId = sessionIdFrom(process.env);
  const relay = new ChannelRelay({
    logPath: paths.log,
    sessionId,
    cwd,
    format: "monitor",
    emit: (delivery) => {
      if (delivery.format === "monitor") process.stdout.write(`${delivery.text}\n`);
    },
    log: (message) => process.stderr.write(`autopark watch: ${message}\n`),
  });
  relay.start();
  if (sessionId && config?.delivery.monitor !== "off") {
    const heartbeat = { kind: "monitor" as const, pid: process.pid, sessionId };
    writeHeartbeat(paths, { ...heartbeat, startedAt: Date.now() });
  }
  process.stderr.write(`autopark watch: tailing ${paths.log}\n`);
  await untilOrphaned();
  relay.stop();
  removeHeartbeat(paths, "monitor", process.pid);
}
