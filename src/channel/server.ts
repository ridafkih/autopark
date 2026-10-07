import { paths } from "../daemon/paths.ts";
import { VERSION } from "../daemon/daemon.ts";
import type { LoggedTransition } from "../core/types.ts";
import { cwdConfig } from "./context.ts";
import { channelContent, channelMeta } from "./meta.ts";
import { StdioMcp } from "./mcp.ts";
import { playbookRef } from "./playbook.ts";
import { inScope } from "./scope.ts";
import { LogTailer } from "./tail.ts";

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
  const p = paths();
  const { config, path } = await cwdConfig(process.cwd());
  const enabled = config?.delivery.channel ?? true;
  const scope = { repos: config?.repos ?? null };
  const log = (m: string) => process.stderr.write(`[pr-autopilot channel] ${m}\n`);
  let tailer: LogTailer | null = null;

  const mcp = new StdioMcp(
    {
      name: "pr-autopilot",
      version: VERSION,
      instructions: channelInstructions(playbookRef(config, path)),
    },
    (s) => process.stdout.write(s),
    () => {
      if (!enabled) return log("delivery.channel is false; staying silent");
      tailer = new LogTailer(p.log, (line) => {
        try {
          const t = JSON.parse(line) as LoggedTransition;
          if (inScope(t, scope)) {
            mcp.notify("notifications/claude/channel", {
              content: channelContent(t),
              meta: channelMeta(t),
            });
          }
        } catch (e) {
          log(`skipping bad line: ${(e as Error).message}`);
        }
      });
      tailer.start();
    },
  );

  process.on("uncaughtException", (e) => log(`error: ${e.message}`));
  process.on("unhandledRejection", (e) => log(`error: ${String(e)}`));
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => mcp.feed(chunk));
  process.stdin.on("end", () => {
    tailer?.stop();
    process.exit(0);
  });
}

if (import.meta.main) void main();
