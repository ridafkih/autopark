import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Paths } from "../../daemon/paths.ts";
import { shellRunner } from "../../daemon/runner.ts";
import { SERVICE_LABEL, serviceFor } from "../../service/index.ts";
import { migrateDefaultHome } from "../../daemon/legacy-home.ts";
import { CliError, note, print } from "../output.ts";
import { ROOT } from "../root.ts";
import type { Invocation } from "./types.ts";

const CONFIG_FLAG = "--config";
const CONFIG_PREFIX = `${CONFIG_FLAG}=`;

export const DAEMON_ENTRY = join(ROOT, "src/daemon/main.ts");

export function configArgs(args: string[]): string[] {
  const [argument, ...rest] = args;
  if (argument === undefined) return [];
  const [value] = rest;
  if (argument === CONFIG_FLAG && value) {
    return [CONFIG_FLAG, resolve(value), ...configArgs(rest.slice(1))];
  }
  if (argument.startsWith(CONFIG_PREFIX)) {
    return [CONFIG_FLAG, resolve(argument.slice(CONFIG_PREFIX.length)), ...configArgs(rest)];
  }
  return configArgs(rest);
}

function serviceSpec(paths: Paths, extraArgs: string[]) {
  return {
    label: SERVICE_LABEL,
    program: [process.execPath, DAEMON_ENTRY, ...extraArgs],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      AUTOPARK_HOME: paths.home,
    },
    logPath: paths.daemonLog,
  };
}

const platformService = () => serviceFor(process.platform, shellRunner);

export async function installService({ argv, paths }: Invocation) {
  migrateDefaultHome(paths, note);
  const service = platformService();
  if (!service) {
    throw new CliError(
      `no service manager for ${process.platform}; run \`autopark daemon run\` under your supervisor`,
    );
  }
  const spec = serviceSpec(paths, configArgs(argv));
  if (argv.includes("--print")) {
    print(service.render(spec));
    return;
  }
  print(`installed ${service.kind} service at ${await service.install(spec)}`);
}

export async function uninstallService() {
  const service = platformService();
  if (!service) throw new CliError(`no service manager for ${process.platform}`);
  await service.uninstall(SERVICE_LABEL);
  print(`removed ${service.kind} service ${SERVICE_LABEL}`);
}

export function installedServiceKind() {
  const service = platformService();
  if (!service || !existsSync(service.path(SERVICE_LABEL))) return null;
  return service.kind;
}
