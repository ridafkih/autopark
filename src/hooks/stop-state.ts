import { readFileSync, writeFileSync } from "node:fs";
import { isNumber, isRecord, parseJson } from "../core/json.ts";
import type { Paths } from "../daemon/paths.ts";

export interface StopEntry {
  blocks: number;
  mark: number;
}

type StopState = Record<string, StopEntry>;

const MAX_REMEMBERED_SESSIONS = 200;

function toStopEntry(value: unknown): StopEntry | null {
  if (isNumber(value)) return { blocks: value, mark: 0 };
  if (isRecord(value) && isNumber(value.blocks) && isNumber(value.mark)) {
    return { blocks: value.blocks, mark: value.mark };
  }
  return null;
}

export function toStopState(value: unknown): StopState {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const parsed = toStopEntry(entry);
      return parsed ? [[key, parsed] as const] : [];
    }),
  );
}

export function readStopState(paths: Paths): StopState {
  try {
    return toStopState(parseJson(readFileSync(paths.stopState, "utf8")));
  } catch {
    return {};
  }
}

function nextStopState(state: StopState, sessionId: string, entry: StopEntry): StopState {
  if (!entry.blocks) {
    return Object.fromEntries(Object.entries(state).filter(([key]) => key !== sessionId));
  }
  return { ...state, [sessionId]: entry };
}

export function writeStopState(paths: Paths, sessionId: string, entry: StopEntry) {
  const next = nextStopState(readStopState(paths), sessionId, entry);
  const entries = Object.entries(next).slice(-MAX_REMEMBERED_SESSIONS);
  writeFileSync(paths.stopState, JSON.stringify(Object.fromEntries(entries)));
}
