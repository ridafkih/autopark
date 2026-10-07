import { mkdirSync } from "node:fs";
import { daemonHealth } from "../../daemon/client.ts";
import type { Paths } from "../../daemon/paths.ts";
import { CliError, print } from "../output.ts";
import {
  configArgs,
  DAEMON_ENTRY,
  installedServiceKind,
  installService,
  uninstallService,
} from "./daemon-service.ts";
import type { CommandHandler, Invocation } from "./types.ts";

const START_ATTEMPTS = 50;
const START_POLL_MS = 100;
const DAEMON_USAGE = "usage: autopark daemon run|start|stop|status|install [--print]|uninstall";

async function hasDaemonStarted(socket: string, attemptsLeft: number): Promise<boolean> {
  if (attemptsLeft <= 0) return false;
  if (await daemonHealth(socket)) return true;
  await Bun.sleep(START_POLL_MS);
  return hasDaemonStarted(socket, attemptsLeft - 1);
}

function spawnDetached(args: string[], paths: Paths) {
  const extra = configArgs(args)
    .map((argument) => JSON.stringify(argument))
    .join(" ");
  const executable = JSON.stringify(process.execPath);
  const entry = JSON.stringify(DAEMON_ENTRY);
  const log = JSON.stringify(paths.daemonLog);
  const command = `exec ${executable} ${entry} ${extra} >> ${log} 2>&1`;
  const subprocess = Bun.spawn(["sh", "-c", command], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, AUTOPARK_HOME: paths.home },
  });
  subprocess.unref();
}

async function runInForeground({ argv }: Invocation) {
  const { runDaemon } = await import("../../daemon/main.ts");
  await runDaemon(argv);
}

async function startDaemon({ argv, paths }: Invocation) {
  if (await daemonHealth(paths.socket)) {
    print("daemon already running");
    return;
  }
  mkdirSync(paths.home, { recursive: true });
  spawnDetached(argv, paths);
  if (!(await hasDaemonStarted(paths.socket, START_ATTEMPTS))) {
    throw new CliError(`daemon did not come up; see ${paths.daemonLog}`);
  }
  print(`daemon started (log ${paths.daemonLog})`);
}

async function stopDaemon({ paths }: Invocation) {
  const health = await daemonHealth(paths.socket);
  if (!health) {
    print("daemon not running");
    return;
  }
  process.kill(health.pid, "SIGTERM");
  const serviceKind = installedServiceKind();
  if (serviceKind) {
    print(
      `note: the ${serviceKind} service will restart it; use \`autopark daemon uninstall\` to stop it for good`,
    );
  }
  print(`sent SIGTERM to ${health.pid}`);
}

async function showDaemonStatus({ paths }: Invocation) {
  const health = await daemonHealth(paths.socket);
  print(health ? JSON.stringify(health, null, 2) : "daemon not running");
}

const ACTIONS = new Map<string | undefined, CommandHandler>([
  ["run", runInForeground],
  ["start", startDaemon],
  ["stop", stopDaemon],
  ["status", showDaemonStatus],
  ["install", installService],
  ["uninstall", uninstallService],
]);

export async function manageDaemon({ argv, paths }: Invocation) {
  const [subcommand, ...rest] = argv;
  const action = ACTIONS.get(subcommand);
  if (!action) throw new CliError(DAEMON_USAGE);
  await action({ argv: rest, paths });
}
