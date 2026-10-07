import { describe, expect, test } from "bun:test";
import { ClockGapWakeDetector } from "../src/daemon/wake.ts";
import { FakeClock } from "./fixtures/clock.ts";

const INTERVAL_MS = 15_000;

describe("wake detector", () => {
  test.each([
    ["regular ticks never fire", [0, 0, 0], []],
    ["small drift is tolerated", [40_000], []],
    ["a sleep gap fires once with the time beyond the interval", [600_000, 0], [585_000]],
  ] as const)("%s", async (label, jumps, expected) => {
    const clock = new FakeClock();
    const detector = new ClockGapWakeDetector(clock, {
      intervalMs: INTERVAL_MS,
      toleranceMs: 45_000,
    });
    const gaps: number[] = [];
    detector.start((gapMs) => gaps.push(gapMs));
    for (const jumpMs of jumps) {
      clock.jump(jumpMs);
      await clock.advance(INTERVAL_MS);
    }
    detector.stop();
    expect(gaps).toEqual([...expected]);
  });
});
