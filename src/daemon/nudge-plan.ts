import { activeHold, type Hold } from "../core/hold.ts";
import { nextNudgeAt, type NudgeState } from "../core/nudge.ts";
import type { Evaluation } from "../core/types.ts";
import type { ConfigSet, RepoEntry } from "./config-set.ts";
import type { PullRequestRecord } from "./store.ts";

export interface NudgeRecord extends PullRequestRecord {
  evaluation: Evaluation;
  nudge: NudgeState;
}

export interface DueNudge {
  record: NudgeRecord;
  entry: RepoEntry;
  dueAt: number;
}

export interface PlanInput {
  records: PullRequestRecord[];
  holds: Hold[];
  configs: ConfigSet;
  now: number;
}

const isNudgeRecord = (record: PullRequestRecord): record is NudgeRecord =>
  record.tracked && record.evaluation !== null && record.nudge !== null;

function dueNudge(record: NudgeRecord, { holds, configs, now }: PlanInput): DueNudge[] {
  const entry = configs.get(record.repo);
  if (!entry) return [];
  const heldUntil = activeHold(record.key, holds, now)?.until ?? null;
  const dueAt = nextNudgeAt(record.nudge, record.evaluation, entry.config.nudge, heldUntil);
  return dueAt === null ? [] : [{ record, entry, dueAt }];
}

export const planNudges = (input: PlanInput): DueNudge[] =>
  input.records.filter(isNudgeRecord).flatMap((record) => dueNudge(record, input));

export function nextWake(input: PlanInput) {
  const dues = planNudges(input).map((due) => due.dueAt);
  const expiries = input.holds.map((hold) => hold.until);
  const candidates = [...dues, ...expiries];
  return candidates.length > 0 ? Math.min(...candidates) : null;
}
