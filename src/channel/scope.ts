import type { LoggedTransition } from "../core/types.ts";
import { storeSessionOf } from "./bindings.ts";

export interface DeliveryScope {
  repos: string[];
  sessionId: string | null;
  sessionOf: (transition: LoggedTransition) => string | null;
}

const CHANNEL_FLAG =
  /--(?:dangerously-load-development-)?channels\b.*\b(?:plugin|server):autopark\b/u;
const PS_LINE = /^(\d+)\s+(.*)$/u;
const ANCESTOR_DEPTH = 8;

export function inScope(transition: LoggedTransition, scope: DeliveryScope) {
  const repo = transition.repo.toLowerCase();
  if (scope.repos.some((candidate) => candidate.toLowerCase() === repo)) return true;
  return scope.sessionId !== null && scope.sessionOf(transition) === scope.sessionId;
}

export function deliveryScope(
  repos: string[],
  sessionId: string | null,
  db: string,
): DeliveryScope {
  return { repos, sessionId, sessionOf: storeSessionOf(db) };
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
