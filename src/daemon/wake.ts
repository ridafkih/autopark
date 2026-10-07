import type { Clock } from "./clock.ts";

export interface WakeDetector {
  start(onWake: (gapMs: number) => void): void;
  stop(): void;
}

export class ClockGapWakeDetector implements WakeDetector {
  private running = false;

  constructor(
    private clock: Clock,
    private opts: { intervalMs: number; toleranceMs: number } = {
      intervalMs: 15_000,
      toleranceMs: 45_000,
    },
  ) {}

  start(onWake: (gapMs: number) => void) {
    this.running = true;
    void (async () => {
      while (this.running) {
        const before = this.clock.now();
        await this.clock.sleep(this.opts.intervalMs);
        if (!this.running) break;
        const gap = this.clock.now() - before - this.opts.intervalMs;
        if (gap > this.opts.toleranceMs) onWake(gap);
      }
    })();
  }

  stop() {
    this.running = false;
  }
}
