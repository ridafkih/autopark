import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  nudges?: boolean;
  log?: (message: string) => void;
  controlCheckMs?: number;
}

const MS_PER_SECOND = 1000;
const CONTROL_CHECK_MS = 5000;

export const logToStderr = (message: string) => {
  process.stderr.write(`[autoparkd] ${message}\n`);
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

function ownsControl(paths: Paths) {
  if (!existsSync(paths.socket) || !existsSync(paths.pid)) return false;
  return readFileSync(paths.pid, "utf8").trim() === String(process.pid);
}

function controlKeeper(
  paths: Paths,
  engine: Engine,
  health: () => Health,
  log: (message: string) => void,
) {
  const servers = [serveControl(paths, engine, health)];
  const reclaim = () => {
    if (ownsControl(paths)) return;
    log(`control socket ${paths.socket} was taken or removed; serving it again`);
    for (const server of servers.splice(0)) void server.stop(true);
    servers.push(serveControl(paths, engine, health));
  };
  const stop = () => {
    for (const server of servers.splice(0)) void server.stop(true);
  };
  return { reclaim, stop };
}

function startWake(options: DaemonOptions, clock: Clock, engine: Engine) {
  const wake = options.wake === undefined ? new ClockGapWakeDetector(clock) : options.wake;
  wake?.start((gapMs) => {
    const seconds = Math.round(gapMs / MS_PER_SECOND);
    void engine.resync(`wake after ${seconds}s gap`);
  });
  return wake;
}

async function startNudgesWhenSettled(engine: Engine) {
  await engine.idle();
  engine.nudges.start();
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

interface Running {
  options: DaemonOptions;
  paths: Paths;
  engine: Engine;
  store: Store;
  log: (message: string) => void;
}

async function startSource(running: Running, source: EventSource) {
  const { options, engine, store, log } = running;
  try {
    await source.start({
      repos: options.configs.repos(),
      deliver: (delivery) => engine.handleDelivery(delivery),
      reconnected: (reason) => void engine.resync(reason),
      log,
    });
  } catch (error) {
    await source.stop();
    await engine.idle();
    store.close();
    throw error;
  }
}

function keepControl(running: Running, health: () => Health) {
  const { options, paths, engine, log } = running;
  const control = controlKeeper(paths, engine, health, log);
  const keeper = setInterval(control.reclaim, options.controlCheckMs ?? CONTROL_CHECK_MS);
  keeper.unref();
  const stop = () => {
    clearInterval(keeper);
    control.stop();
  };
  const release = () => {
    if (!ownsControl(paths)) return;
    rmSync(paths.socket, { force: true });
    rmSync(paths.pid, { force: true });
  };
  return { reclaim: control.reclaim, stop, release };
}

export async function startDaemon(options: DaemonOptions) {
  const paths = resolvePaths(options.home);
  const log = options.log ?? logToStderr;
  if (await daemonHealth(paths.socket)) {
    throw new Error(`a daemon is already running (socket ${paths.socket})`);
  }
  const { clock, store, engine } = createEngine(options, paths, log);
  const source =
    options.source ?? (await createConfiguredSource(options.configs, clock, options.spawn));
  const health = healthReporter(options.configs, source, clock);
  const running: Running = { options, paths, engine, store, log };
  await startSource(running, source);
  const control = keepControl(running, health);
  await engine.resync("start");
  if (options.nudges !== false) void startNudgesWhenSettled(engine);
  const wake = startWake(options, clock, engine);
  const stop = async () => {
    wake?.stop();
    engine.nudges.stop();
    await source.stop();
    control.stop();
    await engine.idle();
    store.close();
    control.release();
  };
  return { engine, store, source, paths, health, stop, reclaimControl: control.reclaim };
}
