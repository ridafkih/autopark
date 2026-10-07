import type { Clock } from "../../src/daemon/clock.ts";

interface Timer {
  due: number;
  resolve: () => void;
}

const FLUSH_ROUNDS = 5;

const nextImmediate = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

export async function flush(rounds = FLUSH_ROUNDS): Promise<void> {
  if (rounds <= 0) return;
  await nextImmediate();
  await flush(rounds - 1);
}

export class FakeClock implements Clock {
  time = 0;
  readonly sleeps: number[] = [];
  private timers: Timer[] = [];

  get pending() {
    return this.timers.length;
  }

  now() {
    return this.time;
  }

  sleep(durationMs: number) {
    this.sleeps.push(durationMs);
    return new Promise<void>((resolve) => {
      this.timers.push({ due: this.time + durationMs, resolve });
    });
  }

  jump(durationMs: number) {
    this.time = this.time + durationMs;
  }

  async advance(durationMs: number) {
    const target = this.time + durationMs;
    await this.fireUntil(target);
    this.time = target;
    await flush();
  }

  private async fireUntil(target: number): Promise<void> {
    await flush();
    const [next, ...rest] = this.timers.toSorted((left, right) => left.due - right.due);
    if (!next || next.due > target) return;
    this.timers = rest;
    this.time = Math.max(this.time, next.due);
    next.resolve();
    await this.fireUntil(target);
  }
}
