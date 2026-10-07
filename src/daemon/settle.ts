import type { PullRequestLocator, Snapshot } from "../core/types.ts";
import type { GitHub } from "../github/types.ts";
import type { Clock } from "./clock.ts";

export interface SettledSnapshot {
  snapshot: Snapshot;
  exhausted: boolean;
  reads: number;
}

interface SettleSources {
  github: GitHub;
  clock: Clock;
}

interface Attempt {
  read: () => Promise<Snapshot>;
  clock: Clock;
  remainingBackoffMs: number[];
  reads: number;
}

const isSettled = (snapshot: Snapshot) =>
  snapshot.state !== "OPEN" || snapshot.mergeable !== "UNKNOWN";

async function settle(snapshot: Snapshot, attempt: Attempt): Promise<SettledSnapshot> {
  if (isSettled(snapshot)) return { snapshot, exhausted: false, reads: attempt.reads };
  const [delayMs, ...remainingBackoffMs] = attempt.remainingBackoffMs;
  if (delayMs === undefined) return { snapshot, exhausted: true, reads: attempt.reads };
  await attempt.clock.sleep(delayMs);
  const next = await attempt.read();
  return settle(next, { ...attempt, remainingBackoffMs, reads: attempt.reads + 1 });
}

export async function fetchSettled(
  { github, clock }: SettleSources,
  { repo, number }: PullRequestLocator,
  backoffMs: number[],
): Promise<SettledSnapshot> {
  const read = () => github.fetchPullRequest(repo, number);
  return settle(await read(), { read, clock, remainingBackoffMs: backoffMs, reads: 1 });
}
