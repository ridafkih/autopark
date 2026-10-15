import { formatDuration } from "../core/duration.ts";
import { errorMessage } from "../core/errors.ts";

export interface SchedulerOptions {
  debounceMs: () => number;
  retryMs: () => number[];
  maxRetries: () => number;
  sleep: (durationMs: number) => Promise<void>;
  deferral?: (error: unknown) => number | null;
  work: (key: string) => Promise<void>;
  log: (message: string) => void;
}

interface Wait {
  delayMs: number;
  isDeferred: boolean;
}

interface Waiting {
  token: object;
  isDeferred: boolean;
}

export class CoalescingScheduler {
  private readonly active = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly options: SchedulerOptions) {}

  get size() {
    return this.active.size;
  }

  schedule(key: string) {
    if (this.active.has(key)) {
      this.dirty.add(key);
      return;
    }
    if (this.waiting.get(key)?.isDeferred) return;
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
    const wait = await this.attempt(key);
    if (this.dirty.has(key) && !wait?.isDeferred) {
      await this.drain(key);
      return;
    }
    this.dirty.delete(key);
    this.active.delete(key);
    if (wait) void this.wake(key, wait);
  }

  private async attempt(key: string): Promise<Wait | null> {
    try {
      await this.options.work(key);
      this.failures.delete(key);
      this.waiting.delete(key);
      return null;
    } catch (error) {
      const deferMs = this.options.deferral?.(error) ?? null;
      if (deferMs !== null) return { delayMs: deferMs, isDeferred: true };
      return this.recordFailure(key, errorMessage(error));
    }
  }

  private recordFailure(key: string, message: string): Wait | null {
    const retries = this.failures.get(key) ?? 0;
    const maxRetries = this.options.maxRetries();
    if (retries >= maxRetries) {
      this.failures.delete(key);
      this.waiting.delete(key);
      this.options.log(
        `recompute ${key} failed: ${message}; giving up after ${maxRetries} retries`,
      );
      return null;
    }
    const delays = this.options.retryMs();
    const delayMs = delays[Math.min(retries, delays.length - 1)] ?? 0;
    this.failures.set(key, retries + 1);
    this.options.log(`recompute ${key} failed: ${message}; retrying in ${formatDuration(delayMs)}`);
    return { delayMs, isDeferred: false };
  }

  private async wake(key: string, { delayMs, isDeferred }: Wait) {
    const token = {};
    this.waiting.set(key, { token, isDeferred });
    await this.options.sleep(delayMs);
    if (this.waiting.get(key)?.token !== token) return;
    this.waiting.delete(key);
    this.schedule(key);
  }
}
