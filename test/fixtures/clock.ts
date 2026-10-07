import type { Clock } from "../../src/daemon/clock.ts";

export const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
};

export class ImmediateClock implements Clock {
  t = 0;
  sleeps: number[] = [];
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.sleeps.push(ms);
    this.t += ms;
  }
}

export class FakeClock implements Clock {
  t = 0;
  sleeps: number[] = [];
  private timers: Array<{ due: number; resolve: () => void }> = [];
  now() {
    return this.t;
  }
  sleep(ms: number) {
    this.sleeps.push(ms);
    return new Promise<void>((resolve) => this.timers.push({ due: this.t + ms, resolve }));
  }
  get pending() {
    return this.timers.length;
  }
  jump(ms: number) {
    this.t += ms;
  }
  async advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      await flush();
      this.timers.sort((a, b) => a.due - b.due);
      const next = this.timers[0];
      if (!next || next.due > target) break;
      this.timers.shift();
      this.t = next.due;
      next.resolve();
    }
    this.t = target;
    await flush();
  }
}
