import type { LoggedTransition } from "../core/types.ts";

export interface DeliveryScope {
  repos: string[] | null;
}

export function inScope(t: LoggedTransition, scope: DeliveryScope) {
  if (!scope.repos) return true;
  return scope.repos.some((r) => r.toLowerCase() === t.repo.toLowerCase());
}

const CHANNEL_FLAG =
  /--(?:dangerously-load-development-)?channels\b.*\b(?:plugin|server):pr-autopilot\b/;

export function channelLoaded(ancestorArgs: string[]) {
  return ancestorArgs.some((a) => CHANNEL_FLAG.test(a));
}

export function monitorShouldEmit(
  mode: "auto" | "always" | "off",
  channelEnabled: boolean,
  loaded: boolean,
) {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return !(channelEnabled && loaded);
}

export function ancestorArgs(start = process.ppid, depth = 8): string[] {
  const out: string[] = [];
  let pid = start;
  for (let i = 0; i < depth && pid > 1; i++) {
    const r = Bun.spawnSync(["ps", "-o", "ppid=,args=", "-p", String(pid)]);
    const line = r.stdout.toString().trim();
    if (!line) break;
    const m = /^(\d+)\s+(.*)$/.exec(line);
    if (!m) break;
    out.push(m[2]!);
    pid = Number(m[1]);
  }
  return out;
}
