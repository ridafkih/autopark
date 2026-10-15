import { describe, expect, test } from "bun:test";
import { CoalescingScheduler } from "../src/daemon/scheduler.ts";
import { RateLimitError } from "../src/github/rate-limit.ts";
import { FakeClock } from "./fixtures/clock.ts";

const PAUSE_MS = 300_000;
const KEY = "acme/widgets#7";

type Outcome = "limited" | "fail" | "ok";

function schedulerWith(outcomes: Outcome[]) {
  const clock = new FakeClock();
  const logs: string[] = [];
  const runs: number[] = [];
  const scheduler = new CoalescingScheduler({
    debounceMs: () => 0,
    retryMs: () => [30_000],
    maxRetries: () => 3,
    sleep: (durationMs) => clock.sleep(durationMs),
    deferral: (error) =>
      error instanceof RateLimitError ? Math.max(0, error.resumeAt - clock.now()) : null,
    work: async () => {
      runs.push(clock.now());
      const next = outcomes.shift() ?? "ok";
      if (next === "limited") throw new RateLimitError("rate limited", clock.now() + PAUSE_MS);
      if (next === "fail") throw new Error("ECONNRESET");
    },
    log: (message) => logs.push(message),
  });
  return { clock, logs, runs, scheduler };
}

describe("rate-limited recomputes wait out the pause", () => {
  test("a rate-limited recompute resumes after each pause and never gives up", async () => {
    const limited = Array.from({ length: 20 }, (): Outcome => "limited");
    const { clock, logs, runs, scheduler } = schedulerWith([...limited, "ok"]);
    scheduler.schedule(KEY);
    await clock.advance(25 * PAUSE_MS);
    expect(runs).toHaveLength(21);
    expect(runs[1]).toBe(PAUSE_MS);
    expect(logs).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  test("events during a pause coalesce into the one queued recompute", async () => {
    const { clock, runs, scheduler } = schedulerWith(["limited", "ok"]);
    scheduler.schedule(KEY);
    await clock.advance(0);
    Array.from({ length: 5 }, () => scheduler.schedule(KEY));
    await clock.advance(1000);
    expect(runs).toEqual([0]);
    await clock.advance(PAUSE_MS);
    expect(runs).toEqual([0, PAUSE_MS]);
    await clock.advance(10 * PAUSE_MS);
    expect(runs).toHaveLength(2);
  });

  test("rate limits do not use up the retry budget for real errors", async () => {
    const { clock, logs, runs, scheduler } = schedulerWith([
      "fail",
      "limited",
      "limited",
      "fail",
      "limited",
      "fail",
      "ok",
    ]);
    scheduler.schedule(KEY);
    await clock.advance(20 * PAUSE_MS);
    expect(runs).toHaveLength(7);
    expect(logs.some((line) => line.includes("giving up"))).toBe(false);
  });
});
