import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { LoggedTransition } from "../core/types.ts";

export interface TransitionSink {
  append(transition: LoggedTransition): void;
}

export class FileSink implements TransitionSink {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    closeSync(openSync(path, "a"));
  }

  append(transition: LoggedTransition) {
    appendFileSync(this.path, `${JSON.stringify(transition)}\n`);
  }
}
