import { ConfigSet } from "../../src/daemon/config-set.ts";
import { Engine } from "../../src/daemon/engine.ts";
import { MemorySink } from "../../src/daemon/memory-sink.ts";
import type { CommandRunner } from "../../src/daemon/runner.ts";
import { Store } from "../../src/daemon/store.ts";
import type { Clock } from "../../src/daemon/clock.ts";
import { ImmediateClock } from "./clock.ts";
import { FakeGitHub } from "./fake-github.ts";
import { config } from "./build.ts";

export class RecordingRunner implements CommandRunner {
  calls: Array<{ command: string; env: Record<string, string>; stdin?: string }> = [];
  code = 0;
  async run(command: string, env: Record<string, string>, stdin?: string) {
    this.calls.push({ command, env, stdin });
    return { code: this.code, stdout: "", stderr: this.code ? "boom" : "" };
  }
}

export async function harness(opts: { clock?: Clock; cfg?: Record<string, unknown> } = {}) {
  const store = new Store(":memory:");
  const sink = new MemorySink();
  const github = new FakeGitHub();
  const clock = opts.clock ?? new ImmediateClock();
  const runner = new RecordingRunner();
  const configs = await ConfigSet.fromConfigs([
    { config: config(opts.cfg), source: "/virtual/.pr-autopilot.yaml" },
  ]);
  const engine = new Engine({ store, sink, github, clock, configs, runner });
  const kinds = () => sink.lines.map((l) => l.kind);
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
