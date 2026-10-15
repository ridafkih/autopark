import { errorMessage } from "../core/errors.ts";
import { evaluate } from "../core/evaluate.ts";
import { diff } from "../core/transitions.ts";
import type { Evaluation, PullRequestState } from "../core/types.ts";
import { isRateLimitError } from "../github/rate-limit.ts";
import type { GitHub } from "../github/types.ts";
import { autoMergeIfReady } from "./auto-merge.ts";
import type { Clock } from "./clock.ts";
import type { ConfigSet, RepoEntry } from "./config-set.ts";
import type { TransitionEmitter } from "./emitter.ts";
import type { Nudger } from "./nudger.ts";
import type { CommandRunner } from "./runner.ts";
import { fetchSettled } from "./settle.ts";
import type { PullRequestRecord, Store } from "./store.ts";

export interface RecomputeDependencies {
  store: Store;
  configs: ConfigSet;
  clock: Clock;
  github: GitHub;
  runner: CommandRunner;
  emitter: TransitionEmitter;
  nudges: Nudger;
}

interface Change {
  key: string;
  previous: Evaluation | null;
  next: Evaluation;
  exhausted: boolean;
  fetchedAt: number;
  entry: RepoEntry;
}

async function readRecorded(
  dependencies: RecomputeDependencies,
  record: PullRequestRecord,
  backoffMs: number[],
) {
  const { store, clock } = dependencies;
  const fetchedAt = clock.now();
  try {
    return { ...(await fetchSettled(dependencies, record, backoffMs)), fetchedAt };
  } catch (error) {
    const kind = isRateLimitError(error) ? "rate_limited" : "error";
    store.recordFailure(record.key, { kind, message: errorMessage(error) }, clock.now());
    throw error;
  }
}

async function commit(dependencies: RecomputeDependencies, change: Change) {
  const { store, clock, nudges, emitter } = dependencies;
  const { key, previous, next, entry } = change;
  const transitions = diff(previous, next, { mergeabilityExhausted: change.exhausted });
  store.saveEvaluation(key, next, clock.now(), change.fetchedAt);
  nudges.observe(key, previous, next);
  for (const transition of transitions) await emitter.emit(transition, next, entry);
  await nudges.askForApprovalOnce(key, next, entry);
  await autoMergeIfReady(key, next, entry, dependencies);
  if (next.state !== "OPEN") store.setTracked(key, false);
}

function trackedEntry({ store, configs }: RecomputeDependencies, key: string) {
  const record = store.getPullRequest(key);
  const entry = record?.tracked ? configs.get(record.repo) : undefined;
  return record && entry ? { record, entry } : null;
}

export async function recompute(dependencies: RecomputeDependencies, key: string) {
  const tracked = trackedEntry(dependencies, key);
  if (!tracked) return;
  const { record, entry } = tracked;
  const read = await readRecorded(dependencies, record, entry.config.daemon.backoffMs);
  const current = trackedEntry(dependencies, key);
  if (!current) return;
  const previous = current.record.evaluation;
  const next = evaluate(read.snapshot, entry.config, entry.parsers, previous);
  await commit(dependencies, { key, previous, next, ...read, entry });
}

export async function closeFromEvent(
  dependencies: RecomputeDependencies,
  key: string,
  state: Exclude<PullRequestState, "OPEN">,
) {
  const tracked = trackedEntry(dependencies, key);
  const previous = tracked?.record.evaluation;
  if (!tracked || previous?.state !== "OPEN") return;
  const next = { ...previous, state, ready: false, mergeableNow: false, awaitingHuman: false };
  const fetchedAt = dependencies.clock.now();
  await commit(dependencies, {
    key,
    previous,
    next,
    exhausted: false,
    fetchedAt,
    entry: tracked.entry,
  });
}
