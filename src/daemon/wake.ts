import type { Clock } from "./clock.ts";

export interface WakeDetector {
  start(onWake: (gapMs: number) => void): void;
  stop(): void;
}

interface WakeOptions {
  intervalMs: number;
  toleranceMs: number;
}

const DEFAULT_WAKE_OPTIONS: WakeOptions = { intervalMs: 15_000, toleranceMs: 45_000 };

export class ClockGapWakeDetector implements WakeDetector {
  private isRunning = false;

  constructor(
    private readonly clock: Clock,
    private readonly options: WakeOptions = DEFAULT_WAKE_OPTIONS,
  ) {}

  start(onWake: (gapMs: number) => void) {
    this.isRunning = true;
    void this.watch(onWake);
  }

  stop() {
    this.isRunning = false;
  }

  private async watch(onWake: (gapMs: number) => void) {
    const { intervalMs, toleranceMs } = this.options;
    while (this.isRunning) {
      const before = this.clock.now();
      await this.clock.sleep(intervalMs);
      if (!this.isRunning) return;
      const gapMs = this.clock.now() - before - intervalMs;
      if (gapMs > toleranceMs) onWake(gapMs);
    }
  }
}
