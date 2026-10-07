import { evaluate } from "../core/evaluate.ts";
import { diff } from "../core/transitions.ts";
import { route, type PrIndex } from "../core/route.ts";
import { matchesTrackFilter, type Candidate } from "../core/track.ts";
import { prKey, type BaseComparison, type Evaluation, type LoggedTransition, type Snapshot, type Transition } from "../core/types.ts";
import type { GitHub } from "../github/types.ts";
import type { Clock } from "./clock.ts";
import type { ConfigSet, RepoEntry } from "./config-set.ts";
import type { TransitionSink } from "./log.ts";
import { notify, transitionEnv } from "./notify.ts";
import type { CommandRunner } from "./runner.ts";
import type { PrRecord, Store } from "./store.ts";

export interface Delivery {
  id: string;
  event: string;
  payload: unknown;
}

export interface EngineDeps {
  store: Store;
  sink: TransitionSink;
  github: GitHub;
  clock: Clock;
  configs: ConfigSet;
  runner: CommandRunner;
  log?: (msg: string) => void;
}

const DELIVERY_TTL_MS = 7 * 24 * 3600 * 1000;

const settledState = (s: Snapshot) => s.state !== "OPEN" || s.mergeable !== "UNKNOWN";

export async function fetchSettled(github: GitHub, clock: Clock, repo: string, number: number, backoff: number[]) {
  let snap = await github.fetchPr(repo, number);
  if (settledState(snap)) return { snap, exhausted: false, reads: 1 };
  let reads = 1;
  for (const ms of backoff) {
    await clock.sleep(ms);
    snap = await github.fetchPr(repo, number);
    reads++;
    if (settledState(snap)) return { snap, exhausted: false, reads };
  }
  return { snap, exhausted: true, reads };
}

export class Engine {
  private runs = new Map<string, { dirty: boolean; promise: Promise<void> }>();
  private compareCache = new Map<string, BaseComparison>();
  private viewerLogin: string | null = null;
  private deliveriesSincePrune = 0;
  private resyncs = new Set<Promise<void>>();
  private log: (msg: string) => void;

  constructor(private deps: EngineDeps) {
    this.log = deps.log ?? (() => {});
    this.viewerLogin = deps.store.getMeta("viewer");
  }

  async handleDelivery(d: Delivery): Promise<{ accepted: boolean; scheduled: string[] }> {
    const { store, clock, configs } = this.deps;
    const now = clock.now();
    if (!store.markDelivery(d.id, d.event, now)) return { accepted: false, scheduled: [] };
    if (++this.deliveriesSincePrune >= 500) {
      this.deliveriesSincePrune = 0;
      store.pruneDeliveries(now - DELIVERY_TTL_MS);
    }
    const r = route(d.event, d.payload, this.index());
    if (!r.repo) return { accepted: true, scheduled: [] };
    const entry = configs.get(r.repo);
    if (!entry) return { accepted: true, scheduled: [] };
    for (const c of r.candidates) await this.maybeAutoTrack(c, entry);
    const scheduled: string[] = [];
    for (const n of r.prs) {
      const key = prKey(r.repo, n);
      if (store.getPr(key)?.tracked) {
        this.schedule(key);
        scheduled.push(key);
      }
    }
    return { accepted: true, scheduled };
  }

  resync(reason: string): Promise<void> {
    const p: Promise<void> = this.doResync(reason).finally(() => this.resyncs.delete(p));
    this.resyncs.add(p);
    return p;
  }

  private async doResync(reason: string) {
    const { store, configs, github } = this.deps;
    this.log(`resync: ${reason}`);
    for (const entry of configs.entries) {
      const f = entry.config.track;
      if (!f.authors.length && !f.branchPrefixes.length && !f.labels.length) continue;
      const authors = f.authors.length === 1 ? f.authors : [null];
      for (const repo of entry.config.repos) {
        for (const author of authors) {
          try {
            const resolved = author === "@me" ? await this.viewer() : author;
            for (const c of await github.searchOpenPrs(repo, resolved)) await this.maybeAutoTrack(c, entry);
          } catch (e) {
            this.log(`resync search failed for ${repo}: ${(e as Error).message}`);
          }
        }
      }
    }
    for (const pr of store.listPrs({ trackedOnly: true })) this.schedule(pr.key);
  }

  track(repo: string, number: number, opts: { sessionId?: string | null; autoMerge?: boolean | null } = {}) {
    const { store, clock, configs } = this.deps;
    if (!configs.get(repo)) throw new Error(`${repo} is not in any loaded pr-autopilot config`);
    const key = store.track({ repo, number, source: "explicit", sessionId: opts.sessionId ?? null, now: clock.now() });
    if (opts.autoMerge !== undefined) store.setAutoMerge(key, opts.autoMerge);
    this.schedule(key);
    return key;
  }

  untrack(repo: string, number: number) {
    this.deps.store.setTracked(prKey(repo, number), false);
  }

  setAutoMerge(repo: string, number: number, enabled: boolean | null) {
    const key = prKey(repo, number);
    if (!this.deps.store.getPr(key)) throw new Error(`${repo}#${number} is not tracked`);
    this.deps.store.setAutoMerge(key, enabled);
    this.schedule(key);
  }

  markReviewRequested(repo: string, number: number, head?: string) {
    const key = prKey(repo, number);
    const rec = this.deps.store.getPr(key);
    if (!rec) throw new Error(`${repo}#${number} is not tracked`);
    const sha = head ?? rec.evaluation?.headSha ?? null;
    this.deps.store.setReviewRequested(key, sha);
    return sha;
  }

  status(): PrRecord[] {
    return this.deps.store.listPrs({ trackedOnly: true });
  }

  schedule(key: string) {
    const existing = this.runs.get(key);
    if (existing) {
      existing.dirty = true;
      return;
    }
    const entry = { dirty: false, promise: Promise.resolve() };
    this.runs.set(key, entry);
    entry.promise = (async () => {
      const debounce = this.deps.configs.daemon.debounceMs;
      if (debounce > 0) await this.deps.clock.sleep(debounce);
      do {
        entry.dirty = false;
        try {
          await this.recompute(key);
        } catch (e) {
          this.log(`recompute ${key} failed: ${(e as Error).message}`);
        }
      } while (entry.dirty);
      this.runs.delete(key);
    })();
  }

  async idle() {
    while (this.runs.size || this.resyncs.size) {
      await Promise.all([...this.resyncs, ...[...this.runs.values()].map((r) => r.promise)]);
    }
  }

  private async viewer() {
    if (!this.viewerLogin) {
      this.viewerLogin = await this.deps.github.viewer();
      this.deps.store.setMeta("viewer", this.viewerLogin);
    }
    return this.viewerLogin;
  }

  private async maybeAutoTrack(c: Candidate, entry: RepoEntry) {
    const key = prKey(c.repo, c.number);
    if (this.deps.store.getPr(key)) return;
    const needsViewer = entry.config.track.authors.includes("@me");
    if (!matchesTrackFilter(c, entry.config.track, needsViewer ? await this.viewer() : null)) return;
    const repo = entry.config.repos.find((r) => r.toLowerCase() === c.repo.toLowerCase()) ?? c.repo;
    this.deps.store.track({ repo, number: c.number, source: "filter", sessionId: null, now: this.deps.clock.now() });
    this.schedule(key);
  }

  private index(): PrIndex {
    const prs = this.deps.store.listPrs({ trackedOnly: true });
    const match = (repo: string, pred: (e: Evaluation | null) => boolean) =>
      prs.filter((p) => p.repo.toLowerCase() === repo && pred(p.evaluation)).map((p) => p.number);
    return {
      bySha: (repo, sha) => match(repo, (e) => !!e && e.headSha === sha.toLowerCase()),
      byHeadRef: (repo, ref) => match(repo, (e) => !!e && e.headRef === ref),
      byBaseRef: (repo, ref) => match(repo, (e) => !e || e.baseRef === ref),
    };
  }

  private async withComparison(snap: Snapshot, entry: RepoEntry): Promise<Snapshot> {
    if (entry.config.readiness.baseFreshness.policy === "off" || snap.state !== "OPEN" || !snap.baseSha || !snap.headSha) return snap;
    const k = `${snap.repo.toLowerCase()}:${snap.headSha}..${snap.baseSha}`;
    let cmp = this.compareCache.get(k);
    if (!cmp) {
      try {
        cmp = await this.deps.github.compare(snap.repo, snap.headSha, snap.baseSha);
        if (this.compareCache.size > 500) this.compareCache.clear();
        this.compareCache.set(k, cmp);
      } catch (e) {
        this.log(`compare ${k} failed: ${(e as Error).message}`);
        return snap;
      }
    }
    return { ...snap, baseComparison: cmp };
  }

  private async recompute(key: string) {
    const { store, configs, clock } = this.deps;
    const rec = store.getPr(key);
    if (!rec?.tracked) return;
    const entry = configs.get(rec.repo);
    if (!entry) return;
    const settled = await fetchSettled(this.deps.github, this.deps.clock, rec.repo, rec.number, entry.config.daemon.backoffMs);
    const snap = await this.withComparison(settled.snap, entry);
    const prev = store.getPr(key)?.evaluation ?? null;
    const next = evaluate(snap, entry.config, entry.parsers, prev);
    const transitions = diff(prev, next, { mergeabilityExhausted: settled.exhausted });
    store.saveEvaluation(key, next, clock.now());
    for (const t of transitions) await this.emit(t, next, entry);
    await this.maybeAutoMerge(key, next, entry);
    if (next.state !== "OPEN") store.setTracked(key, false);
  }

  private async emit(t: Transition, e: Evaluation, entry: RepoEntry) {
    const now = this.deps.clock.now();
    const id = this.deps.store.appendTransition(t, now);
    const lt: LoggedTransition = { ...t, id, ts: new Date(now).toISOString(), title: e.title, url: e.url };
    this.deps.sink.append(lt);
    await notify(lt, entry.config, this.deps.runner, this.log);
  }

  private autoMergeEnabled(rec: PrRecord, e: Evaluation, entry: RepoEntry) {
    if (rec.autoMerge !== null) return rec.autoMerge;
    const am = entry.config.autoMerge;
    return am.default || e.labels.some((l) => am.labels.includes(l));
  }

  private async maybeAutoMerge(key: string, e: Evaluation, entry: RepoEntry) {
    const rec = this.deps.store.getPr(key);
    if (!rec || !e.mergeableNow || !this.autoMergeEnabled(rec, e, entry) || rec.mergeAttemptHead === e.headSha) return;
    this.deps.store.setMergeAttempt(key, e.headSha);
    const method = entry.config.autoMerge.method;
    const base: Transition = { kind: "merge_attempted", repo: e.repo, number: e.number, head: e.headSha, reason: "", data: { method } };
    try {
      const cmd = entry.config.autoMerge.command;
      if (cmd) {
        const env = transitionEnv({ ...base, id: 0, ts: "", title: e.title, url: e.url });
        const r = await this.deps.runner.run(cmd, { ...env, PR_AUTOPILOT_MERGE_METHOD: method });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `merge command exited ${r.code}`);
      } else {
        await this.deps.github.merge(e.repo, e.number, e.headSha, method);
      }
      await this.emit({ ...base, reason: `auto-merge (${method}) requested for ${e.headSha.slice(0, 7)}`, data: { method, ok: true } }, e, entry);
    } catch (err) {
      await this.emit({ ...base, reason: `auto-merge failed: ${(err as Error).message}`, data: { method, ok: false, error: (err as Error).message } }, e, entry);
    }
  }
}
