import { existsSync } from "node:fs";
import { hasStrings, isNumber, memberOf, isRecord, isStringArray } from "../core/json.ts";
import { SOURCE_STATES, type SourceStatus } from "../sources/types.ts";
import type { Health } from "./control.ts";

export const VERSION = "0.1.0";

const CONTROL_TIMEOUT_MS = 2000;

const isSourceState = memberOf(SOURCE_STATES);

const isPerRepo = (value: unknown) =>
  value === undefined || (isRecord(value) && Object.values(value).every(isSourceState));

const isSourceStatus = (value: unknown): value is SourceStatus =>
  isRecord(value) &&
  hasStrings(value, ["name", "detail"]) &&
  isSourceState(value.state) &&
  isPerRepo(value.perRepo);

export const isHealth = (value: unknown): value is Health =>
  isRecord(value) &&
  value.ok === true &&
  isNumber(value.pid) &&
  hasStrings(value, ["startedAt", "version"]) &&
  isStringArray(value.repos) &&
  isSourceStatus(value.source);

export function controlFetch(socket: string, path: string, init: RequestInit = {}) {
  return fetch(`http://localhost${path}`, {
    ...init,
    unix: socket,
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  });
}

export async function daemonHealth(socket: string): Promise<Health | null> {
  if (!existsSync(socket)) return null;
  try {
    const response = await controlFetch(socket, "/health");
    if (!response.ok) return null;
    const health: unknown = await response.json();
    return isHealth(health) ? health : null;
  } catch {
    return null;
  }
}
