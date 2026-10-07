import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoggedTransition } from "../../src/core/types.ts";
import { ConfigSet } from "../../src/daemon/config-set.ts";
import { startDaemon } from "../../src/daemon/daemon.ts";
import type { ReplaySource } from "../../src/sources/replay.ts";
import { config } from "./build.ts";
import { FakeGitHub } from "./fake-github.ts";
import { RecordingRunner } from "./harness.ts";
import { ImmediateClock } from "./immediate-clock.ts";
import { parseJson } from "../../src/core/json.ts";
import { toLoggedTransition } from "../../src/core/transition-codec.ts";

export interface BootOptions {
  source?: ReplaySource;
  config?: Record<string, unknown>;
  configDir?: string;
  prepare?: (github: FakeGitHub) => void;
}

const running: Array<() => Promise<void>> = [];

export async function stopDaemons() {
  for (const stop of running.splice(0)) await stop();
}

export const readLog = (path: string): LoggedTransition[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const transition = toLoggedTransition(parseJson(line));
      if (!transition) throw new Error(`not a transition: ${line}`);
      return transition;
    });

export async function bootDaemon(options: BootOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), "apl-int-"));
  const github = new FakeGitHub();
  options.prepare?.(github);
  const source = join(options.configDir ?? home, ".autopark.yaml");
  const configs = await ConfigSet.fromConfigs([{ config: config(options.config), source }]);
  const daemon = await startDaemon({
    configs,
    github,
    home,
    clock: new ImmediateClock(),
    source: options.source,
    wake: null,
    runner: new RecordingRunner(),
    log: () => {},
  });
  running.push(() => daemon.stop());
  return { home, github, daemon };
}
