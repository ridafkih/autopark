import { errorMessage } from "../core/errors.ts";
import { resolvePaths } from "../daemon/paths.ts";
import type { CommandHandler } from "./commands/types.ts";
import { CliError, print } from "./output.ts";
import { USAGE } from "./usage.ts";

const lazy =
  <Module>(load: () => Promise<Module>, pick: (module: Module) => CommandHandler): CommandHandler =>
  async (invocation) => {
    const handler = pick(await load());
    await handler(invocation);
  };

const printUsage: CommandHandler = () => print(USAGE);

const COMMANDS = new Map<string | undefined, CommandHandler>([
  [
    "status",
    lazy(
      () => import("./commands/status.ts"),
      (module) => module.showStatus,
    ),
  ],
  [
    "track",
    lazy(
      () => import("./commands/track.ts"),
      (module) => module.trackPullRequest,
    ),
  ],
  [
    "untrack",
    lazy(
      () => import("./commands/untrack.ts"),
      (module) => module.untrackPullRequest,
    ),
  ],
  [
    "auto-merge",
    lazy(
      () => import("./commands/auto-merge.ts"),
      (module) => module.setAutoMerge,
    ),
  ],
  [
    "request-review",
    lazy(
      () => import("./commands/request-review.ts"),
      (module) => module.requestReview,
    ),
  ],
  [
    "check",
    lazy(
      () => import("./commands/check.ts"),
      (module) => module.checkPullRequest,
    ),
  ],
  [
    "init",
    lazy(
      () => import("./commands/init.ts"),
      (module) => module.initProject,
    ),
  ],
  [
    "validate",
    lazy(
      () => import("./commands/validate.ts"),
      (module) => module.validateConfig,
    ),
  ],
  [
    "register",
    lazy(
      () => import("./commands/register.ts"),
      (module) => module.registerConfig,
    ),
  ],
  [
    "schema",
    lazy(
      () => import("./commands/schema.ts"),
      (module) => module.printSchema,
    ),
  ],
  [
    "doctor",
    lazy(
      () => import("./commands/doctor.ts"),
      (module) => module.runDoctor,
    ),
  ],
  [
    "daemon",
    lazy(
      () => import("./commands/daemon.ts"),
      (module) => module.manageDaemon,
    ),
  ],
  [
    "hook",
    lazy(
      () => import("./commands/hook.ts"),
      (module) => module.runHookCommand,
    ),
  ],
  [
    "watch",
    lazy(
      () => import("./commands/watch.ts"),
      (module) => module.watchTransitions,
    ),
  ],
  [
    "ship-context",
    lazy(
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
    process.stderr.write(`pr-autopilot: ${errorMessage(error)}\n`);
    process.exit(1);
  }
}
