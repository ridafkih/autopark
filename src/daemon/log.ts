import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { LoggedTransition } from "../core/types.ts";

export interface TransitionSink {
  append(t: LoggedTransition): void;
}

export class FileSink implements TransitionSink {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    closeSync(openSync(path, "a"));
  }
  append(t: LoggedTransition) {
    appendFileSync(this.path, JSON.stringify(t) + "\n");
  }
}

export class MemorySink implements TransitionSink {
  lines: LoggedTransition[] = [];
  append(t: LoggedTransition) {
    this.lines.push(t);
  }
}
