import { describe, expect, test } from "bun:test";
import { formatDuration, parseDuration } from "../src/core/duration.ts";

describe("durations", () => {
  test.each([
    ["30s", 30_000],
    ["10m", 600_000],
    ["1h", 3_600_000],
    ["1h30m", 5_400_000],
    ["500ms", 500],
    ["2d", 172_800_000],
    ["0s", 0],
  ] as const)("%s parses", (text, expected) => {
    expect(parseDuration(text)).toBe(expected);
  });

  test.each(["", "10", "m", "10 m", "1.5h", "-1m", "10x"])("%p is rejected", (text) => {
    expect(parseDuration(text)).toBeNull();
  });

  test.each([
    [0, "0s"],
    [45_000, "45s"],
    [600_000, "10m"],
    [3_600_000, "1h"],
    [3_900_000, "1h05m"],
    [90_060_000, "25h01m"],
  ] as const)("%d formats as %s", (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});
