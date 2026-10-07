import type { Evaluation, LoggedTransition, Transition } from "../core/types.ts";
import type { Clock } from "./clock.ts";
import type { RepoEntry } from "./config-set.ts";
import type { TransitionSink } from "./log.ts";
import { notify } from "./notify.ts";
import type { CommandRunner } from "./runner.ts";
import type { Store } from "./store.ts";

export interface EmitterDependencies {
  store: Store;
  sink: TransitionSink;
  clock: Clock;
  runner: CommandRunner;
  log: (message: string) => void;
}

export class TransitionEmitter {
  constructor(private readonly dependencies: EmitterDependencies) {}

  async emit(transition: Transition, evaluation: Evaluation, entry: RepoEntry) {
    const { store, sink, clock, runner, log } = this.dependencies;
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
    await notify(logged, entry.config, runner, log);
  }
}
