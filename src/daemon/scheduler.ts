import { errorMessage } from "../core/errors.ts";

export interface SchedulerOptions {
  debounceMs: () => number;
  sleep: (durationMs: number) => Promise<void>;
  work: (key: string) => Promise<void>;
  log: (message: string) => void;
}

export class CoalescingScheduler {
  private readonly active = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();

  constructor(private readonly options: SchedulerOptions) {}

  get size() {
    return this.active.size;
  }

  schedule(key: string) {
    if (this.active.has(key)) {
      this.dirty.add(key);
      return;
    }
    this.active.set(key, this.run(key));
  }

  pending() {
    return [...this.active.values()];
  }

  private async run(key: string) {
    const debounceMs = this.options.debounceMs();
    if (debounceMs > 0) await this.options.sleep(debounceMs);
    await this.drain(key);
  }

  private async drain(key: string): Promise<void> {
    this.dirty.delete(key);
    try {
      await this.options.work(key);
    } catch (error) {
      this.options.log(`recompute ${key} failed: ${errorMessage(error)}`);
    }
    if (this.dirty.has(key)) {
      await this.drain(key);
      return;
    }
    this.active.delete(key);
  }
}
