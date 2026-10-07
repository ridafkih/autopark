const UNIT_MS = new Map([
  ["ms", 1],
  ["s", 1000],
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
]);

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const PAD_WIDTH = 2;

export const DURATION_PATTERN = /^(?:\d+(?:ms|s|m|h|d))+$/u;
const DURATION_PART = /(\d+)(ms|s|m|h|d)/gu;

export function parseDuration(text: string): number | null {
  if (!DURATION_PATTERN.test(text)) return null;
  return [...text.matchAll(DURATION_PART)].reduce(
    (total, [, amount, unit]) => total + Number(amount) * (UNIT_MS.get(unit ?? "") ?? 0),
    0,
  );
}

export function formatDuration(durationMs: number) {
  const totalMinutes = Math.floor(Math.max(0, durationMs) / MS_PER_MINUTE);
  if (totalMinutes === 0) return `${Math.floor(Math.max(0, durationMs) / MS_PER_SECOND)}s`;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  const padded = String(minutes).padStart(PAD_WIDTH, "0");
  return `${hours}h${padded}m`;
}

export const formatRemaining = (durationMs: number) =>
  formatDuration(Math.ceil(durationMs / MS_PER_MINUTE) * MS_PER_MINUTE);
