import type { CommandRunner } from "../daemon/runner.ts";
import { LaunchdService } from "./launchd.ts";
import { SystemdService } from "./systemd.ts";
import type { ServiceManager } from "./types.ts";

export const SERVICE_LABEL = "dev.pr-autopilot.daemon";

export function serviceFor(platform: string, runner: CommandRunner): ServiceManager | null {
  if (platform === "darwin") return new LaunchdService({ runner });
  if (platform === "linux") return new SystemdService({ runner });
  return null;
}
