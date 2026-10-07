import { errorMessage } from "../core/errors.ts";
import {
  activeHold,
  ALL_PULL_REQUESTS,
  checkHoldDuration,
  DEFAULT_HOLD_MS,
  isHoldFor,
  type Hold,
} from "../core/hold.ts";
import { markNudged, trackNudge } from "../core/nudge.ts";
import { holdExpiredTransition, nextStep, nudgeTransition } from "../core/nudge-message.ts";
import { summarize, type PullRequestSummary } from "../core/summary.ts";
import type { Evaluation } from "../core/types.ts";
import type { Clock } from "./clock.ts";
import type { ConfigSet } from "./config-set.ts";
import type { TransitionEmitter } from "./emitter.ts";
import { nextWake, planNudges, type DueNudge, type PlanInput } from "./nudge-plan.ts";
import { SingleTimer } from "./single-timer.ts";
import type { PullRequestRecord, Store } from "./store.ts";

export interface NudgerDependencies {
  store: Store;
  clock: Clock;
  configs: ConfigSet;
  emitter: TransitionEmitter;
  log: (message: string) => void;
}

export class Nudger {
  private readonly timer: SingleTimer;
  private isRunning = false;
  private isStopped = false;

  constructor(private readonly dependencies: NudgerDependencies) {
    this.timer = new SingleTimer(dependencies.clock, () => this.tick());
  }

  start() {
    if (this.isStopped) return;
    this.isRunning = true;
    this.rearm();
  }

  stop() {
    this.isStopped = true;
    this.isRunning = false;
    this.timer.cancel();
  }

  observe(key: string, previous: Evaluation | null, next: Evaluation) {
    const { store, clock } = this.dependencies;
    const current = store.getPullRequest(key)?.nudge ?? null;
    store.saveNudge(key, trackNudge(current, previous, next, clock.now()));
    this.rearm();
  }

  hold(target: string, durationMs = DEFAULT_HOLD_MS, reason: string | null = null): Hold {
    const { store, clock } = this.dependencies;
    checkHoldDuration(durationMs);
    if (target !== ALL_PULL_REQUESTS && !store.getPullRequest(target)?.tracked) {
      throw new Error(`${target} is not tracked`);
    }
    const now = clock.now();
    const hold = { target, until: now + durationMs, reason, createdAt: now };
    store.setHold(hold);
    this.rearm();
    return hold;
  }

  unhold(target: string) {
    const { store } = this.dependencies;
    if (target === ALL_PULL_REQUESTS) store.clearAllHolds();
    else store.clearHold(target);
    this.rearm();
  }

  summaries(records: PullRequestRecord[]): PullRequestSummary[] {
    const input = this.planInput(records);
    const dues = new Map(planNudges(input).map((due) => [due.record.key, due.dueAt]));
    const context = { now: input.now, holds: input.holds };
    return records.map((record) =>
      summarize(record, { ...context, nextNudgeAt: dues.get(record.key) ?? null }),
    );
  }

  private planInput(records = this.trackedRecords()): PlanInput {
    const { store, clock, configs } = this.dependencies;
    return { records, holds: store.listHolds(), configs, now: clock.now() };
  }

  private trackedRecords() {
    return this.dependencies.store.listPullRequests({ trackedOnly: true });
  }

  private rearm() {
    if (this.isRunning) this.timer.arm(nextWake(this.planInput()));
  }

  private async tick() {
    try {
      await this.expireHolds();
      const input = this.planInput();
      const due = planNudges(input).filter((candidate) => candidate.dueAt <= input.now);
      for (const candidate of due) await this.nudge(candidate, input.now);
    } catch (error) {
      this.dependencies.log(`nudge failed: ${errorMessage(error)}`);
    }
    this.rearm();
  }

  private async nudge({ record, entry }: DueNudge, now: number) {
    const { store, emitter } = this.dependencies;
    const { evaluation, nudge } = record;
    const transition = nudgeTransition({ evaluation, state: nudge, config: entry.config, now });
    store.saveNudge(record.key, markNudged(nudge, now, nextStep(evaluation, entry.config)));
    await emitter.emit(transition, evaluation, entry);
  }

  private async expireHolds() {
    const { store } = this.dependencies;
    const { holds, now } = this.planInput([]);
    const expired = holds.filter((hold) => hold.until <= now);
    if (expired.length === 0) return;
    for (const hold of expired) store.clearHold(hold.target);
    const remaining = store.listHolds();
    for (const record of this.trackedRecords()) {
      const ended = expired.find((hold) => isHoldFor(hold, record.key));
      if (ended && !activeHold(record.key, remaining, now)) await this.announce(record, ended);
    }
  }

  private async announce(record: PullRequestRecord, hold: Hold) {
    const { configs, emitter } = this.dependencies;
    const { evaluation } = record;
    const entry = configs.get(record.repo);
    if (!entry || evaluation?.state !== "OPEN") return;
    const transition = holdExpiredTransition(evaluation, hold, entry.config);
    await emitter.emit(transition, evaluation, entry);
  }
}
