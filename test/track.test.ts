import { describe, expect, test } from "bun:test";
import { matchesTrackFilter } from "../src/core/track.ts";

const candidate = {
  repo: "acme/widgets",
  number: 7,
  author: "octo",
  headRef: "bot/tidy",
  baseRef: "main",
  labels: ["autopark"],
  open: true,
};

describe("track filter", () => {
  test.each([
    ["no filters tracks nothing", {}, false],
    ["author match", { authors: ["octo"] }, true],
    ["author is case-insensitive", { authors: ["OCTO"] }, true],
    ["@me resolves to the viewer", { authors: ["@me"] }, true],
    ["author mismatch", { authors: ["someone"] }, false],
    ["branch prefix match", { branchPrefixes: ["bot/"] }, true],
    ["branch prefix mismatch", { branchPrefixes: ["feature/"] }, false],
    ["label match", { labels: ["autopark"] }, true],
    ["label mismatch", { labels: ["other"] }, false],
    ["all dimensions must match", { authors: ["octo"], branchPrefixes: ["feature/"] }, false],
    [
      "any value within a dimension matches",
      { authors: ["someone", "octo"], branchPrefixes: ["feature/", "bot/"] },
      true,
    ],
  ])("%s", (label, filter, expected) => {
    const trackFilter = { authors: [], branchPrefixes: [], labels: [], ...filter };
    expect(matchesTrackFilter(candidate, trackFilter, "octo")).toBe(expected);
  });

  test("closed candidates never auto-track", () => {
    expect(
      matchesTrackFilter(
        { ...candidate, open: false },
        { authors: ["octo"], branchPrefixes: [], labels: [] },
        "octo",
      ),
    ).toBe(false);
  });
});
