import type { LoggedTransition } from "../core/types.ts";

export interface DeliveryScope {
  repos: string[];
  sessionId: string | null;
  sessionOf: (transition: LoggedTransition) => string | null;
}

export function inScope(transition: LoggedTransition, scope: DeliveryScope) {
  if (scope.sessionId !== null) return scope.sessionOf(transition) === scope.sessionId;
  const repo = transition.repo.toLowerCase();
  return scope.repos.some((candidate) => candidate.toLowerCase() === repo);
}

export function monitorShouldEmit(
  mode: "auto" | "always" | "off",
  isChannelEnabled: boolean,
  isChannelLive: boolean,
) {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return !(isChannelEnabled && isChannelLive);
}
