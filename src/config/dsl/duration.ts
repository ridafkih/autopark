import { DURATION_PATTERN, formatDuration, parseDuration } from "../../core/duration.ts";
import { definedEntries, fail, typeName, type Issue, type Meta, type Schema } from "./core.ts";

interface DurationOptions extends Meta {
  default?: string;
  minMs?: number;
}

const DURATION_HINT = "a duration like 30s, 10m or 1h30m";

function parseText(value: unknown, path: string, issues: Issue[], minMs: number) {
  if (typeof value !== "string") {
    return fail(issues, path, `expected ${DURATION_HINT}, got ${typeName(value)}`);
  }
  const parsed = parseDuration(value);
  if (parsed === null) return fail(issues, path, `must be ${DURATION_HINT}`);
  if (parsed < minMs) return fail(issues, path, `must be at least ${formatDuration(minMs)}`);
  return parsed;
}

export function durationSchema(options: DurationOptions = {}): Schema<number> {
  const minMs = options.minMs ?? 0;
  const defaultMs = options.default === undefined ? null : parseDuration(options.default);
  return {
    hasDefault: defaultMs !== null,
    parse(value, path, issues) {
      if (value === undefined && defaultMs !== null) return defaultMs;
      return parseText(value, path, issues, minMs);
    },
    json: () => ({
      type: "string",
      pattern: DURATION_PATTERN.source,
      ...definedEntries({ default: options.default, description: options.description }),
    }),
  };
}
