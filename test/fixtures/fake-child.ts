import type { ChildHandle } from "../../src/sources/types.ts";

const KILLED_EXIT_CODE = 143;

export class FakeChild implements ChildHandle {
  readonly exited: Promise<number>;
  readonly lines: AsyncIterable<string>;
  isKilled = false;
  private readonly pending: string[] = [];
  private readonly resolveExit: (code: number) => void;
  private wake: (() => void) | null = null;
  private isDone = false;

  constructor(readonly command: string[]) {
    const { promise, resolve } = Promise.withResolvers<number>();
    this.exited = promise;
    this.resolveExit = resolve;
    this.lines = this.drain();
  }

  emit(line: string) {
    this.pending.push(line);
    this.wake?.();
  }

  exit(code: number) {
    this.isDone = true;
    this.wake?.();
    this.resolveExit(code);
  }

  kill() {
    this.isKilled = true;
    this.exit(KILLED_EXIT_CODE);
  }

  private async nextWake() {
    await new Promise<void>((resolve) => {
      this.wake = resolve;
    });
    this.wake = null;
  }

  private async *drain() {
    while (!this.isDone || this.pending.length > 0) {
      const line = this.pending.shift();
      if (line === undefined) {
        await this.nextWake();
      } else {
        yield line;
      }
    }
  }
}

export function childAt(children: FakeChild[], index: number) {
  const child = children[index];
  if (!child) throw new Error(`no forwarder child at ${index}`);
  return child;
}
