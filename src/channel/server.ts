import { VERSION } from "../daemon/client.ts";
import { resolvePaths } from "../daemon/paths.ts";
import { cwdConfig } from "./context.ts";
import { StdioMcp } from "./mcp.ts";
import { playbookRef } from "./playbook.ts";
import { ChannelRelay } from "./relay.ts";

const log = (message: string) => {
  process.stderr.write(`[pr-autopilot channel] ${message}\n`);
};

export function channelInstructions(playbook: string) {
  return [
    'pr-autopilot pushes pull request state transitions as <channel source="..." kind="..." repo="..." pr="..." head="...">.',
    "Each event is computed by the local pr-autopilot daemon from GitHub's current state, so it is a fact, not a request from a person.",
    `React to each kind using ${playbook}.`,
    "Act on PRs this session is driving (`pr-autopilot status --session <session id>`); treat other PRs' events as information.",
    "Pending checks or reviews need no action, and GitHub never needs to be polled: the next event arrives on its own.",
  ].join(" ");
}

async function main() {
  const { config, path } = await cwdConfig(process.cwd());
  const instructions = channelInstructions(playbookRef(config, path));
  const relayOptions = {
    logPath: resolvePaths().log,
    scope: { repos: config?.repos ?? null },
    isEnabled: config?.delivery.channel ?? true,
    log,
  };
  const mcp = new StdioMcp(
    { name: "pr-autopilot", version: VERSION, instructions },
    (text) => process.stdout.write(text),
    () => relay.start(),
  );
  const relay = new ChannelRelay(mcp, relayOptions);
  process.on("uncaughtException", (error) => log(`error: ${error.message}`));
  process.on("unhandledRejection", (reason) => log(`error: ${String(reason)}`));
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => mcp.feed(chunk));
  process.stdin.on("end", () => {
    relay.stop();
    process.exit(0);
  });
}

if (import.meta.main) await main();
