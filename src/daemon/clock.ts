export interface Clock {
  now(): number;
  sleep(durationMs: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (durationMs) => Bun.sleep(durationMs),
};
