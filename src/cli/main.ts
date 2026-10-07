import { errorMessage } from "../core/errors.ts";
import { resolvePaths } from "../daemon/paths.ts";
import type { CommandHandler } from "./commands/types.ts";
import { CliError, print } from "./output.ts";
import { USAGE } from "./usage.ts";

const lazyCommand =
  <Module>(load: () => Promise<Module>, pick: (module: Module) => CommandHandler): CommandHandler =>
  async (invocation) => {
    const handler = pick(await load());
    await handler(invocation);
  };

const printUsage: CommandHandler = () => print(USAGE);

const COMMANDS = new Map<string | undefined, CommandHandler>([
  [
    "status",
    lazyCommand(
      () => import("./commands/status.ts"),
      (module) => module.showStatus,
    ),
  ],
  [
    "track",
    lazyCommand(
      () => import("./commands/track.ts"),
      (module) => module.trackPullRequest,
    ),
  ],
  [
    "untrack",
    lazyCommand(
      () => import("./commands/untrack.ts"),
      (module) => module.untrackPullRequest,
    ),
  ],
  [
    "auto-merge",
    lazyCommand(
      () => import("./commands/auto-merge.ts"),
      (module) => module.setAutoMerge,
    ),
  ],
  [
    "request-review",
    lazyCommand(
      () => import("./commands/request-review.ts"),
      (module) => module.requestReview,
    ),
  ],
  [
    "hold",
    lazyCommand(
      () => import("./commands/hold.ts"),
      (module) => module.holdPullRequests,
    ),
  ],
  [
    "unhold",
    lazyCommand(
      () => import("./commands/hold.ts"),
      (module) => module.unholdPullRequests,
    ),
  ],
  [
    "check",
    lazyCommand(
      () => import("./commands/check.ts"),
      (module) => module.checkPullRequest,
    ),
  ],
  [
    "init",
    lazyCommand(
      () => import("./commands/init.ts"),
      (module) => module.initProject,
    ),
  ],
  [
    "validate",
    lazyCommand(
      () => import("./commands/validate.ts"),
      (module) => module.validateConfig,
    ),
  ],
  [
    "register",
    lazyCommand(
      () => import("./commands/register.ts"),
      (module) => module.registerConfig,
    ),
  ],
  [
    "schema",
    lazyCommand(
      () => import("./commands/schema.ts"),
      (module) => module.printSchema,
    ),
  ],
  [
    "doctor",
    lazyCommand(
      () => import("./commands/doctor.ts"),
      (module) => module.runDoctor,
    ),
  ],
  [
    "daemon",
    lazyCommand(
      () => import("./commands/daemon.ts"),
      (module) => module.manageDaemon,
    ),
  ],
  [
    "hook",
    lazyCommand(
      () => import("./commands/hook.ts"),
      (module) => module.runHookCommand,
    ),
  ],
  [
    "watch",
    lazyCommand(
      () => import("./commands/watch.ts"),
      (module) => module.watchTransitions,
    ),
  ],
  [
    "ship-context",
    lazyCommand(
      () => import("./commands/ship-context.ts"),
      (module) => module.printShipContext,
    ),
  ],
  [undefined, printUsage],
  ["help", printUsage],
  ["--help", printUsage],
  ["-h", printUsage],
]);

export async function main(argv: string[]) {
  const [name, ...rest] = argv;
  const command = COMMANDS.get(name);
  if (!command) throw new CliError(`unknown command ${name}\n\n${USAGE}`);
  await command({ argv: rest, paths: resolvePaths() });
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`autopark: ${errorMessage(error)}\n`);
    process.exit(1);
  }
}
