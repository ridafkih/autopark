import { readFileSync, writeFileSync } from "node:fs";
import { isNumber, isRecord, isString, parseJson, type JsonRecord } from "../core/json.ts";
import type { Paths } from "../daemon/paths.ts";
import type { BriefMemory } from "./stop-brief.ts";

export interface StopEntry extends BriefMemory {
  blocks: number;
  mark: number;
}

type StopState = Record<string, StopEntry>;

const MAX_REMEMBERED_SESSIONS = 200;

const toBriefMemory = (record: JsonRecord): BriefMemory => ({
  fingerprint: isString(record.fingerprint) ? record.fingerprint : null,
  briefs: isNumber(record.briefs) ? record.briefs : 0,
});

function toStopEntry(value: unknown): StopEntry | null {
  if (isNumber(value)) return { blocks: value, mark: 0, fingerprint: null, briefs: 0 };
  if (isRecord(value) && isNumber(value.blocks) && isNumber(value.mark)) {
    return { blocks: value.blocks, mark: value.mark, ...toBriefMemory(value) };
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
  if (!entry.blocks && entry.fingerprint === null) {
    return Object.fromEntries(Object.entries(state).filter(([key]) => key !== sessionId));
  }
  return { ...state, [sessionId]: entry };
}

export function writeStopState(paths: Paths, sessionId: string, entry: StopEntry) {
  const next = nextStopState(readStopState(paths), sessionId, entry);
  const entries = Object.entries(next).slice(-MAX_REMEMBERED_SESSIONS);
  writeFileSync(paths.stopState, JSON.stringify(Object.fromEntries(entries)));
}
