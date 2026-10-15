import type { LoggedTransition } from "../core/types.ts";
import { storeSessionOf } from "./bindings.ts";

export interface DeliveryScope {
  repos: string[];
  sessionId: string | null;
  sessionOf: (transition: LoggedTransition) => string | null;
}

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

export function monitorShouldEmit(
  mode: "auto" | "always" | "off",
  isChannelEnabled: boolean,
  isChannelLive: boolean,
) {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return !(isChannelEnabled && isChannelLive);
}
