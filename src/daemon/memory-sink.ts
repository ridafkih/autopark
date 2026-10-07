import type { LoggedTransition } from "../core/types.ts";
import type { TransitionSink } from "./log.ts";

export class MemorySink implements TransitionSink {
  readonly lines: LoggedTransition[] = [];

  append(transition: LoggedTransition) {
    this.lines.push(transition);
  }
}
