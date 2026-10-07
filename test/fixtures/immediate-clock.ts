import type { Clock } from "../../src/daemon/clock.ts";

export class ImmediateClock implements Clock {
  time = 0;
  readonly sleeps: number[] = [];

  now() {
    return this.time;
  }

  async sleep(durationMs: number) {
    this.sleeps.push(durationMs);
    this.time = this.time + durationMs;
  }
}
