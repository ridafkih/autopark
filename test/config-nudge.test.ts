import { describe, expect, test } from "bun:test";
import { configJsonSchema, parseConfig } from "../src/config/schema.ts";
import { valueAt } from "../src/core/json.ts";
import { NUDGE_KINDS, REASON_CODES } from "../src/core/types.ts";

const minimal = { repos: ["acme/widgets"] };
const MINUTE = 60_000;

describe("nudge config", () => {
  test("defaults nudge every blocked PR after ten minutes, except drafts", () => {
    const result = parseConfig(minimal);
    if (!result.ok) throw new Error("unexpected");
    expect(result.config.nudge).toEqual({
      after: 10 * MINUTE,
      every: 10 * MINUTE,
      escalateAfter: null,
      kinds: NUDGE_KINDS.filter((kind) => kind !== "draft"),
      quietWhenHeadMoving: true,
      nudgeReadyUnmerged: false,
    });
  });

  test("every reason code but closed can nudge, and so can awaiting_human", () => {
    const expected = [...REASON_CODES.filter((code) => code !== "closed"), "awaiting_human"];
    const actual: string[] = [...NUDGE_KINDS];
    expect(actual.toSorted()).toEqual(expected.toSorted());
  });

  test("durations are written as text", () => {
    const result = parseConfig({
      ...minimal,
      nudge: { after: "5m", every: "1h", escalateAfter: "1h30m", kinds: ["awaiting_human"] },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.config.nudge).toMatchObject({
      after: 5 * MINUTE,
      every: 60 * MINUTE,
      escalateAfter: 90 * MINUTE,
      kinds: ["awaiting_human"],
    });
  });

  test.each([
    ["a bare number", { after: 10 }, "nudge.after"],
    ["an unknown unit", { after: "10x" }, "nudge.after"],
    ["a repeat shorter than a minute", { every: "30s" }, "nudge.every"],
    ["a bad escalation", { escalateAfter: "soon" }, "nudge.escalateAfter"],
    ["closed as a kind", { kinds: ["closed"] }, "nudge.kinds[0]"],
    ["an unknown key", { interval: "5m" }, "nudge.interval"],
  ])("%s is rejected", (label, nudge, path) => {
    const result = parseConfig({ ...minimal, nudge });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });

  test("the JSON Schema documents durations as strings with their defaults", () => {
    const after = valueAt(configJsonSchema(), "properties", "nudge", "properties", "after");
    expect(after).toMatchObject({ type: "string", default: "10m" });
  });
});
