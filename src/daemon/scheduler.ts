import { formatDuration } from "../core/duration.ts";
import { errorMessage } from "../core/errors.ts";

export interface SchedulerOptions {
  debounceMs: () => number;
  retryMs: () => number[];
  maxRetries: () => number;
  sleep: (durationMs: number) => Promise<void>;
  work: (key: string) => Promise<void>;
  log: (message: string) => void;
}

export class CoalescingScheduler {
  private readonly active = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
  private readonly failures = new Map<string, number>();

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
    const retryInMs = await this.attempt(key);
    if (this.dirty.has(key)) {
      await this.drain(key);
      return;
    }
    this.active.delete(key);
    if (retryInMs !== null) void this.retryLater(key, retryInMs);
  }

  private async attempt(key: string): Promise<number | null> {
    try {
      await this.options.work(key);
      this.failures.delete(key);
      return null;
    } catch (error) {
      return this.recordFailure(key, errorMessage(error));
    }
  }

  private recordFailure(key: string, message: string) {
    const retries = this.failures.get(key) ?? 0;
    const maxRetries = this.options.maxRetries();
    if (retries >= maxRetries) {
      this.failures.delete(key);
      this.options.log(
        `recompute ${key} failed: ${message}; giving up after ${maxRetries} retries`,
      );
      return null;
    }
    const delays = this.options.retryMs();
    const delayMs = delays[Math.min(retries, delays.length - 1)] ?? 0;
    this.failures.set(key, retries + 1);
    this.options.log(`recompute ${key} failed: ${message}; retrying in ${formatDuration(delayMs)}`);
    return delayMs;
  }

  private async retryLater(key: string, delayMs: number) {
    await this.options.sleep(delayMs);
    if (this.failures.has(key)) this.schedule(key);
  }
}
