import type { LoggedTransition } from "../core/types.ts";

export interface DeliveryScope {
  repos: string[] | null;
}

const CHANNEL_FLAG =
  /--(?:dangerously-load-development-)?channels\b.*\b(?:plugin|server):pr-autopilot\b/u;
const PS_LINE = /^(\d+)\s+(.*)$/u;
const ANCESTOR_DEPTH = 8;

export function inScope(transition: LoggedTransition, scope: DeliveryScope) {
  if (!scope.repos) return true;
  const repo = transition.repo.toLowerCase();
  return scope.repos.some((candidate) => candidate.toLowerCase() === repo);
}

export const channelLoaded = (commandLines: string[]) =>
  commandLines.some((commandLine) => CHANNEL_FLAG.test(commandLine));

export function monitorShouldEmit(
  mode: "auto" | "always" | "off",
  isChannelEnabled: boolean,
  isLoaded: boolean,
) {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return !(isChannelEnabled && isLoaded);
}

export function ancestorArgs(start = process.ppid, depth = ANCESTOR_DEPTH): string[] {
  if (depth <= 0 || start <= 1) return [];
  const result = Bun.spawnSync(["ps", "-o", "ppid=,args=", "-p", String(start)]);
  const [, parent, args] = PS_LINE.exec(result.stdout.toString().trim()) ?? [];
  if (parent === undefined || args === undefined) return [];
  return [args, ...ancestorArgs(Number(parent), depth - 1)];
}
