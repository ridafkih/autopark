import { formatDuration } from "./duration.ts";

export const ALL_PULL_REQUESTS = "*";
export const DEFAULT_HOLD_MS = 30 * 60_000;
export const MAX_HOLD_MS = 4 * 3_600_000;

export interface Hold {
  target: string;
  until: number;
  reason: string | null;
  createdAt: number;
}

export interface HoldView {
  until: number;
  reason: string | null;
  scope: "pr" | "all";
}

export function checkHoldDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError("a hold must last longer than 0");
  }
  if (durationMs > MAX_HOLD_MS) {
    throw new RangeError(`a hold lasts at most ${formatDuration(MAX_HOLD_MS)}`);
  }
  return durationMs;
}

export const isHoldFor = (hold: Hold, key: string) =>
  hold.target === ALL_PULL_REQUESTS || hold.target === key;

export function activeHold(key: string, holds: Hold[], now: number): HoldView | null {
  const active = holds
    .filter((hold) => isHoldFor(hold, key) && hold.until > now)
    .toSorted((left, right) => right.until - left.until);
  const [latest] = active;
  if (!latest) return null;
  const scope = latest.target === ALL_PULL_REQUESTS ? "all" : "pr";
  return { until: latest.until, reason: latest.reason, scope };
}
