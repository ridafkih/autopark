import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GitHub } from "../github/types.ts";
import { createSource } from "../sources/index.ts";
import { bunSpawner } from "../sources/gh-webhook-forward.ts";
import type { EventSource, Spawner } from "../sources/types.ts";
import { systemClock, type Clock } from "./clock.ts";
import type { ConfigSet } from "./config-set.ts";
import { controlHandler, type Health } from "./control.ts";
import { Engine } from "./engine.ts";
import { FileSink } from "./log.ts";
import { paths } from "./paths.ts";
import { shellRunner, type CommandRunner } from "./runner.ts";
import { Store } from "./store.ts";
import { ClockGapWakeDetector, type WakeDetector } from "./wake.ts";

export const VERSION = "0.1.0";

export interface DaemonOptions {
  configs: ConfigSet;
  github: GitHub;
  home?: string;
  clock?: Clock;
  spawn?: Spawner;
  runner?: CommandRunner;
  source?: EventSource;
  wake?: WakeDetector | null;
  log?: (msg: string) => void;
}

export async function controlFetch(socket: string, path: string, init: RequestInit = {}) {
  return fetch(`http://localhost${path}`, {
    ...init,
    unix: socket,
    signal: AbortSignal.timeout(2000),
  } as RequestInit);
}

export async function daemonHealth(socket: string): Promise<Health | null> {
  if (!existsSync(socket)) return null;
  try {
    const res = await controlFetch(socket, "/health");
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export async function startDaemon(o: DaemonOptions) {
  const p = paths(o.home);
  const log = o.log ?? ((m: string) => console.error(`[pr-autopilotd] ${m}`));
  if (await daemonHealth(p.socket))
    throw new Error(`a daemon is already running (socket ${p.socket})`);
  const clock = o.clock ?? systemClock;
  const store = new Store(p.db);
  const sink = new FileSink(p.log);
  const engine = new Engine({
    store,
    sink,
    github: o.github,
    clock,
    configs: o.configs,
    runner: o.runner ?? shellRunner,
    log,
  });
  const d = o.configs.daemon;
  const secret = process.env[d.secretEnv] || randomBytes(32).toString("hex");
  const source =
    o.source ??
    (await createSource(d.source.type, d.source.options, {
      clock,
      port: d.port,
      secret,
      spawn: o.spawn ?? bunSpawner,
      baseDir: dirname(o.configs.entries[0]!.source),
    }));
  const startedAt = new Date(clock.now()).toISOString();
  const health = (): Health => ({
    ok: true,
    pid: process.pid,
    startedAt,
    version: VERSION,
    repos: o.configs.repos(),
    source: source.status(),
  });

  rmSync(p.socket, { force: true });
  const control = Bun.serve({ unix: p.socket, fetch: controlHandler(engine, health) });
  writeFileSync(p.pid, String(process.pid));

  await source.start({
    repos: o.configs.repos(),
    deliver: (dl) => engine.handleDelivery(dl),
    reconnected: (reason) => void engine.resync(reason),
    log,
  });
  await engine.resync("start");
  const wake = o.wake === undefined ? new ClockGapWakeDetector(clock) : o.wake;
  wake?.start((gap) => void engine.resync(`wake after ${Math.round(gap / 1000)}s gap`));

  return {
    engine,
    store,
    source,
    paths: p,
    health,
    async stop() {
      wake?.stop();
      await source.stop();
      control.stop(true);
      await engine.idle();
      store.close();
      rmSync(p.socket, { force: true });
      rmSync(p.pid, { force: true });
    },
  };
}
