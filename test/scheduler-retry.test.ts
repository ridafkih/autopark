import { describe, expect, test } from "bun:test";
import { CoalescingScheduler } from "../src/daemon/scheduler.ts";
import { FakeClock } from "./fixtures/clock.ts";

const RATE_LIMITED = "GraphQL: API rate limit already exceeded for user ID 1.";

function schedulerWith(outcomes: Array<"fail" | "ok">) {
  const clock = new FakeClock();
  const logs: string[] = [];
  const runs: number[] = [];
  const scheduler = new CoalescingScheduler({
    debounceMs: () => 0,
    retryMs: () => [30_000, 60_000],
    maxRetries: () => 3,
    sleep: (durationMs) => clock.sleep(durationMs),
    work: async () => {
      runs.push(clock.now());
      if ((outcomes.shift() ?? "ok") === "fail") throw new Error(RATE_LIMITED);
    },
    log: (message) => logs.push(message),
  });
  return { clock, logs, runs, scheduler };
}

describe("failed recomputes back off and retry", () => {
  test("a rate-limited recompute retries on the backoff schedule until it succeeds", async () => {
    const { clock, logs, runs, scheduler } = schedulerWith(["fail", "fail", "ok"]);
    scheduler.schedule("acme/widgets#7");
    await clock.advance(0);
    expect(runs).toEqual([0]);
    expect(logs[0]).toContain("retrying in 30s");
    await clock.advance(30_000);
    expect(runs).toEqual([0, 30_000]);
    expect(logs[1]).toContain("retrying in 1m");
    await clock.advance(60_000);
    expect(runs).toEqual([0, 30_000, 90_000]);
    await clock.advance(600_000);
    expect(runs).toHaveLength(3);
    expect(clock.pending).toBe(0);
  });

  test("it gives up after maxRetries and says so", async () => {
    const { clock, logs, runs, scheduler } = schedulerWith([
      "fail",
      "fail",
      "fail",
      "fail",
      "fail",
    ]);
    scheduler.schedule("acme/widgets#7");
    await clock.advance(3_600_000);
    expect(runs).toHaveLength(4);
    expect(logs.at(-1)).toContain("giving up after 3 retries");
    expect(clock.pending).toBe(0);
  });

  test("a later success from a new event cancels the pending retry", async () => {
    const { clock, runs, scheduler } = schedulerWith(["fail", "ok"]);
    scheduler.schedule("acme/widgets#7");
    await clock.advance(10_000);
    scheduler.schedule("acme/widgets#7");
    await clock.advance(60_000);
    expect(runs).toEqual([0, 10_000]);
  });
});
