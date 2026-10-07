import { errorMessage } from "../core/errors.ts";
import { evaluate } from "../core/evaluate.ts";
import { route } from "../core/route.ts";
import { diff } from "../core/transitions.ts";
import {
  pullRequestKey,
  type Evaluation,
  type LoggedTransition,
  type Transition,
} from "../core/types.ts";
import type { GitHub } from "../github/types.ts";
import type { Delivery } from "../sources/types.ts";
import {
  isAutoMergeEnabled,
  mergeAttempt,
  mergeFailed,
  mergeSucceeded,
  runMerge,
} from "./auto-merge.ts";
import { AutoTracker } from "./auto-tracker.ts";
import type { Clock } from "./clock.ts";
import { ComparisonCache } from "./comparison-cache.ts";
import type { ConfigSet, RepoEntry } from "./config-set.ts";
import type { TransitionSink } from "./log.ts";
import { notify } from "./notify.ts";
import { pullRequestIndex } from "./pull-request-index.ts";
import type { CommandRunner } from "./runner.ts";
import { CoalescingScheduler } from "./scheduler.ts";
import { fetchSettled } from "./settle.ts";
import type { PullRequestRecord, Store } from "./store.ts";

export interface EngineDependencies {
  store: Store;
  sink: TransitionSink;
  github: GitHub;
  clock: Clock;
  configs: ConfigSet;
  runner: CommandRunner;
  log?: (message: string) => void;
}

export interface TrackOptions {
  sessionId?: string | null;
  autoMerge?: boolean | null;
}

interface DeliveryResult {
  accepted: boolean;
  scheduled: string[];
}

const DELIVERY_TTL_MS = 7 * 24 * 3600 * 1000;
const PRUNE_EVERY_DELIVERIES = 500;

export class Engine {
  private readonly resyncs = new Set<Promise<void>>();
  private readonly log: (message: string) => void;
  private readonly comparisons: ComparisonCache;
  private readonly scheduler: CoalescingScheduler;
  private readonly tracker: AutoTracker;
  private deliveriesSincePrune = 0;

  constructor(private readonly dependencies: EngineDependencies) {
    this.log = dependencies.log ?? (() => {});
    this.comparisons = new ComparisonCache(dependencies.github, this.log);
    this.scheduler = new CoalescingScheduler({
      debounceMs: () => dependencies.configs.daemon.debounceMs,
      sleep: (durationMs) => dependencies.clock.sleep(durationMs),
      work: (key) => this.recompute(key),
      log: this.log,
    });
    this.tracker = new AutoTracker({
      ...dependencies,
      log: this.log,
      schedule: (key) => this.schedule(key),
    });
  }

  async handleDelivery(delivery: Delivery): Promise<DeliveryResult> {
    const { store, clock, configs } = this.dependencies;
    const now = clock.now();
    if (!store.markDelivery(delivery.id, delivery.event, now)) {
      return { accepted: false, scheduled: [] };
    }
    this.prunePeriodically(now);
    const records = store.listPullRequests({ trackedOnly: true });
    const routed = route(delivery.event, delivery.payload, pullRequestIndex(records));
    const { repo } = routed;
    const entry = repo ? configs.get(repo) : undefined;
    if (!repo || !entry) return { accepted: true, scheduled: [] };
    for (const candidate of routed.candidates) await this.tracker.consider(candidate, entry);
    const scheduled = routed.pullRequests
      .map((number) => pullRequestKey(repo, number))
      .filter((key) => store.getPullRequest(key)?.tracked);
    for (const key of scheduled) this.schedule(key);
    return { accepted: true, scheduled };
  }

  resync(reason: string): Promise<void> {
    const pending = this.runResync(reason);
    this.resyncs.add(pending);
    return this.forgetWhenSettled(pending);
  }

  track(repo: string, number: number, options: TrackOptions = {}) {
    const { store, clock, configs } = this.dependencies;
    if (!configs.get(repo)) throw new Error(`${repo} is not in any loaded autopark config`);
    const sessionId = options.sessionId ?? null;
    const key = store.track({ repo, number, source: "explicit", sessionId, now: clock.now() });
    if (options.autoMerge !== undefined) store.setAutoMerge(key, options.autoMerge);
    this.schedule(key);
    return key;
  }

  untrack(repo: string, number: number) {
    this.dependencies.store.setTracked(pullRequestKey(repo, number), false);
  }

  setAutoMerge(repo: string, number: number, enabled: boolean | null) {
    const key = this.requireTracked(repo, number).key;
    this.dependencies.store.setAutoMerge(key, enabled);
    this.schedule(key);
  }

  markReviewRequested(repo: string, number: number, head?: string) {
    const record = this.requireTracked(repo, number);
    const sha = head ?? record.evaluation?.headSha ?? null;
    this.dependencies.store.setReviewRequested(record.key, sha);
    return sha;
  }

  status(): PullRequestRecord[] {
    return this.dependencies.store.listPullRequests({ trackedOnly: true });
  }

  schedule(key: string) {
    this.scheduler.schedule(key);
  }

  async idle() {
    while (this.scheduler.size > 0 || this.resyncs.size > 0) {
      await Promise.all([...this.resyncs, ...this.scheduler.pending()]);
    }
  }

  private requireTracked(repo: string, number: number) {
    const record = this.dependencies.store.getPullRequest(pullRequestKey(repo, number));
    if (!record) throw new Error(`${repo}#${number} is not tracked`);
    return record;
  }

  private async forgetWhenSettled(pending: Promise<void>) {
    try {
      await pending;
    } finally {
      this.resyncs.delete(pending);
    }
  }

  private prunePeriodically(now: number) {
    this.deliveriesSincePrune = this.deliveriesSincePrune + 1;
    if (this.deliveriesSincePrune < PRUNE_EVERY_DELIVERIES) return;
    this.deliveriesSincePrune = 0;
    this.dependencies.store.pruneDeliveries(now - DELIVERY_TTL_MS);
  }

  private async runResync(reason: string) {
    const { store, configs } = this.dependencies;
    this.log(`resync: ${reason}`);
    for (const entry of configs.entries) await this.tracker.discover(entry);
    for (const record of store.listPullRequests({ trackedOnly: true })) this.schedule(record.key);
  }

  private async recompute(key: string) {
    const { store, configs, clock } = this.dependencies;
    const record = store.getPullRequest(key);
    const entry = record?.tracked ? configs.get(record.repo) : undefined;
    if (!record || !entry) return;
    const settled = await fetchSettled(this.dependencies, record, entry.config.daemon.backoffMs);
    const snapshot = await this.comparisons.attach(settled.snapshot, entry);
    const previous = store.getPullRequest(key)?.evaluation ?? null;
    const next = evaluate(snapshot, entry.config, entry.parsers, previous);
    const transitions = diff(previous, next, { mergeabilityExhausted: settled.exhausted });
    store.saveEvaluation(key, next, clock.now());
    for (const transition of transitions) await this.emit(transition, next, entry);
    await this.maybeAutoMerge(key, next, entry);
    if (next.state !== "OPEN") store.setTracked(key, false);
  }

  private async emit(transition: Transition, evaluation: Evaluation, entry: RepoEntry) {
    const { store, sink, clock, runner } = this.dependencies;
    const now = clock.now();
    const id = store.appendTransition(transition, now);
    const logged: LoggedTransition = {
      ...transition,
      id,
      ts: new Date(now).toISOString(),
      title: evaluation.title,
      url: evaluation.url,
    };
    sink.append(logged);
    await notify(logged, entry.config, runner, this.log);
  }

  private async maybeAutoMerge(key: string, evaluation: Evaluation, entry: RepoEntry) {
    const { store } = this.dependencies;
    const config = entry.config.autoMerge;
    const record = store.getPullRequest(key);
    if (!record || !evaluation.mergeableNow) return;
    if (!isAutoMergeEnabled(record, evaluation, config)) return;
    if (record.mergeAttemptHead === evaluation.headSha) return;
    store.setMergeAttempt(key, evaluation.headSha);
    const attempt = mergeAttempt(evaluation, config);
    try {
      await runMerge(attempt, evaluation, config, this.dependencies);
      await this.emit(mergeSucceeded(attempt, config), evaluation, entry);
    } catch (error) {
      await this.emit(mergeFailed(attempt, config, errorMessage(error)), evaluation, entry);
    }
  }
}
