import type { Clock } from "../../src/daemon/clock.ts";
import { ConfigSet } from "../../src/daemon/config-set.ts";
import { Engine } from "../../src/daemon/engine.ts";
import { MemorySink } from "../../src/daemon/memory-sink.ts";
import type { CommandRunner } from "../../src/daemon/runner.ts";
import { Store } from "../../src/daemon/store.ts";
import { config } from "./build.ts";
import { FakeGitHub } from "./fake-github.ts";
import { ImmediateClock } from "./immediate-clock.ts";

interface RunnerCall {
  command: string;
  env: Record<string, string>;
  stdin?: string;
}

interface HarnessOptions {
  clock?: Clock;
  config?: Record<string, unknown>;
}

export class RecordingRunner implements CommandRunner {
  readonly calls: RunnerCall[] = [];
  code = 0;

  async run(command: string, env: Record<string, string>, stdin?: string) {
    this.calls.push({ command, env, stdin });
    return { code: this.code, stdout: "", stderr: this.code ? "boom" : "" };
  }
}

export async function createHarness(options: HarnessOptions = {}) {
  const store = new Store(":memory:");
  const sink = new MemorySink();
  const github = new FakeGitHub();
  const clock = options.clock ?? new ImmediateClock();
  const runner = new RecordingRunner();
  const configs = await ConfigSet.fromConfigs([
    { config: config(options.config), source: "/virtual/.pr-autopilot.yaml" },
  ]);
  const engine = new Engine({ store, sink, github, clock, configs, runner });
  const kinds = () => sink.lines.map((line) => line.kind);
  return { store, sink, github, clock, runner, configs, engine, kinds };
}

export const repository = { full_name: "acme/widgets" };

export const pullRequestPayload = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  state: "open",
  user: { login: "octo" },
  head: { ref: "bot/tidy", sha: "1111111111111111111111111111111111111111" },
  base: { ref: "main" },
  labels: [],
  ...extra,
});
