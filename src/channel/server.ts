import { PAUSE_RULE } from "../core/nudge-message.ts";
import { sessionIdFrom } from "../core/session.ts";
import { VERSION } from "../daemon/client.ts";
import { resolvePaths, type Paths } from "../daemon/paths.ts";
import { cwdConfig } from "./context.ts";
import { StdioMcp } from "./mcp.ts";
import { playbookRef } from "./playbook.ts";
import { removeHeartbeat, writeHeartbeat } from "./heartbeat.ts";
import { ChannelRelay } from "./relay.ts";

const log = (message: string) => {
  process.stderr.write(`[autopark channel] ${message}\n`);
};

export function channelInstructions(playbook: string) {
  return [
    'autopark pushes pull request state transitions as <channel source="..." kind="..." repo="..." pr="..." head="...">.',
    "Each event is computed by the local autopark daemon from GitHub's current state, so it is a fact, not a request from a person.",
    `React to each kind using ${playbook}.`,
    "Act on PRs this session is driving (`autopark status --session <session id>`); treat other PRs' events as information.",
    "Pending checks or reviews need no action, and GitHub never needs to be polled: the next event arrives on its own.",
    "A stuck PR is re-announced as a `nudge` until it is ready, merged or held.",
    PAUSE_RULE,
  ].join(" ");
}

function announce(paths: Paths, sessionId: string | null) {
  if (!sessionId) return;
  const heartbeat = { kind: "channel" as const, pid: process.pid, sessionId };
  writeHeartbeat(paths, { ...heartbeat, startedAt: Date.now() });
}

async function main() {
  const cwd = process.cwd();
  const { config, path } = await cwdConfig(cwd);
  const instructions = channelInstructions(playbookRef(config, path));
  const paths = resolvePaths();
  const sessionId = sessionIdFrom(process.env);
  const mcp = new StdioMcp(
    { name: "autopark", version: VERSION, instructions },
    (text) => process.stdout.write(text),
    () => {
      relay.start();
      announce(paths, sessionId);
    },
  );
  const relay = new ChannelRelay({
    logPath: paths.log,
    sessionId,
    cwd,
    format: "channel",
    emit: (delivery) => {
      if (delivery.format !== "channel") return;
      mcp.notify("notifications/claude/channel", {
        content: delivery.content,
        meta: delivery.meta,
      });
    },
    log,
  });
  process.on("uncaughtException", (error) => log(`error: ${error.message}`));
  process.on("unhandledRejection", (reason) => log(`error: ${String(reason)}`));
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => mcp.feed(chunk));
  process.stdin.on("end", () => {
    relay.stop();
    removeHeartbeat(paths, "channel", process.pid);
    process.exit(0);
  });
}

if (import.meta.main) await main();
