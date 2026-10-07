import { rmSync, writeFileSync } from "node:fs";
import type { GitHub } from "../github/types.ts";
import type { EventSource, Spawner } from "../sources/types.ts";
import { daemonHealth, VERSION } from "./client.ts";
import { systemClock, type Clock } from "./clock.ts";
import type { ConfigSet } from "./config-set.ts";
import { createConfiguredSource } from "./event-source.ts";
import { controlHandler, type Health } from "./control.ts";
import { Engine } from "./engine.ts";
import { FileSink } from "./log.ts";
import { resolvePaths, type Paths } from "./paths.ts";
import { shellRunner, type CommandRunner } from "./runner.ts";
import { Store } from "./store.ts";
import { ClockGapWakeDetector, type WakeDetector } from "./wake.ts";

export interface DaemonOptions {
  configs: ConfigSet;
  github: GitHub;
  home?: string;
  clock?: Clock;
  spawn?: Spawner;
  runner?: CommandRunner;
  source?: EventSource;
  wake?: WakeDetector | null;
  log?: (message: string) => void;
}

const MS_PER_SECOND = 1000;

export const logToStderr = (message: string) => {
  process.stderr.write(`[pr-autopilotd] ${message}\n`);
};

function healthReporter(configs: ConfigSet, source: EventSource, clock: Clock) {
  const startedAt = new Date(clock.now()).toISOString();
  return (): Health => ({
    ok: true,
    pid: process.pid,
    startedAt,
    version: VERSION,
    repos: configs.repos(),
    source: source.status(),
  });
}

function serveControl(paths: Paths, engine: Engine, health: () => Health) {
  rmSync(paths.socket, { force: true });
  const server = Bun.serve({ unix: paths.socket, fetch: controlHandler(engine, health) });
  writeFileSync(paths.pid, String(process.pid));
  return server;
}

function startWake(options: DaemonOptions, clock: Clock, engine: Engine) {
  const wake = options.wake === undefined ? new ClockGapWakeDetector(clock) : options.wake;
  wake?.start((gapMs) => {
    const seconds = Math.round(gapMs / MS_PER_SECOND);
    void engine.resync(`wake after ${seconds}s gap`);
  });
  return wake;
}

function createEngine(options: DaemonOptions, paths: Paths, log: (message: string) => void) {
  const clock = options.clock ?? systemClock;
  const store = new Store(paths.db);
  const engine = new Engine({
    store,
    sink: new FileSink(paths.log),
    github: options.github,
    clock,
    configs: options.configs,
    runner: options.runner ?? shellRunner,
    log,
  });
  return { clock, store, engine };
}

export async function startDaemon(options: DaemonOptions) {
  const paths = resolvePaths(options.home);
  const log = options.log ?? logToStderr;
  if (await daemonHealth(paths.socket)) {
    throw new Error(`a daemon is already running (socket ${paths.socket})`);
  }
  const { configs } = options;
  const { clock, store, engine } = createEngine(options, paths, log);
  const source = options.source ?? (await createConfiguredSource(configs, clock, options.spawn));
  const health = healthReporter(configs, source, clock);
  const control = serveControl(paths, engine, health);
  await source.start({
    repos: configs.repos(),
    deliver: (delivery) => engine.handleDelivery(delivery),
    reconnected: (reason) => void engine.resync(reason),
    log,
  });
  await engine.resync("start");
  const wake = startWake(options, clock, engine);
  const stop = async () => {
    wake?.stop();
    await source.stop();
    void control.stop(true);
    await engine.idle();
    store.close();
    rmSync(paths.socket, { force: true });
    rmSync(paths.pid, { force: true });
  };
  return { engine, store, source, paths, health, stop };
}
