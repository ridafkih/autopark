import { route, type Lifecycle } from "../core/route.ts";
import { pullRequestKey } from "../core/types.ts";
import { isRateLimitError } from "../github/rate-limit.ts";
import type { GitHub } from "../github/types.ts";
import type { Delivery } from "../sources/types.ts";
import { AutoTracker } from "./auto-tracker.ts";
import type { Clock } from "./clock.ts";
import type { ConfigSet } from "./config-set.ts";
import { TransitionEmitter } from "./emitter.ts";
import type { TransitionSink } from "./log.ts";
import { Nudger } from "./nudger.ts";
import { pullRequestIndex } from "./pull-request-index.ts";
import type { CommandRunner } from "./runner.ts";
import { closeFromEvent, recompute, type RecomputeDependencies } from "./recompute.ts";
import { CoalescingScheduler } from "./scheduler.ts";
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
const RECOMPUTE_RETRY_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
const RECOMPUTE_MAX_RETRIES = 12;
const MIN_RATE_LIMIT_WAIT_MS = 1000;

export class Engine {
  readonly nudges: Nudger;
  private readonly resyncs = new Set<Promise<void>>();
  private readonly log: (message: string) => void;
  private readonly scheduler: CoalescingScheduler;
  private readonly tracker: AutoTracker;
  private readonly emitter: TransitionEmitter;
  private readonly recomputing: RecomputeDependencies;
  private deliveriesSincePrune = 0;

  constructor(private readonly dependencies: EngineDependencies) {
    this.log = dependencies.log ?? (() => {});
    this.emitter = new TransitionEmitter({ ...dependencies, log: this.log });
    this.nudges = new Nudger({ ...dependencies, emitter: this.emitter, log: this.log });
    this.recomputing = { ...dependencies, emitter: this.emitter, nudges: this.nudges };
    this.scheduler = new CoalescingScheduler({
      debounceMs: () => dependencies.configs.daemon.debounceMs,
      retryMs: () => RECOMPUTE_RETRY_MS,
      maxRetries: () => RECOMPUTE_MAX_RETRIES,
      sleep: (durationMs) => dependencies.clock.sleep(durationMs),
      deferral: (error) => this.rateLimitWait(error),
      work: (key) => recompute(this.recomputing, key),
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
    if (routed.lifecycle) await this.applyLifecycle(repo, routed.lifecycle);
    return { accepted: true, scheduled: this.scheduleEvent(repo, routed.pullRequests, now) };
  }

  githubPause() {
    return this.dependencies.github.pause?.() ?? null;
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

  markReviewRequested(repo: string, number: number, head?: string, isReady?: boolean) {
    const record = this.requireTracked(repo, number);
    const sha = head ?? record.evaluation?.headSha ?? null;
    const ready = isReady ?? record.evaluation?.awaitingHuman ?? false;
    this.dependencies.store.setReviewRequested(record.key, sha, ready);
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

  private scheduleEvent(repo: string, numbers: number[], now: number) {
    const { store } = this.dependencies;
    const scheduled = numbers
      .map((number) => pullRequestKey(repo, number))
      .filter((key) => store.getPullRequest(key)?.tracked);
    for (const key of scheduled) {
      store.markEvent(key, now);
      this.schedule(key);
    }
    return scheduled;
  }

  private async applyLifecycle(repo: string, { number, change }: Lifecycle) {
    const { store } = this.dependencies;
    const key = pullRequestKey(repo, number);
    if (change !== "reopened") {
      await closeFromEvent(this.recomputing, key, change === "merged" ? "MERGED" : "CLOSED");
      return;
    }
    const record = store.getPullRequest(key);
    if (record && !record.tracked && record.evaluation?.state === "CLOSED") {
      store.setTracked(key, true);
    }
  }

  private rateLimitWait(error: unknown) {
    if (!isRateLimitError(error)) return null;
    return Math.max(MIN_RATE_LIMIT_WAIT_MS, error.resumeAt - this.dependencies.clock.now());
  }
}
