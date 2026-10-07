import { describe, expect, test } from "bun:test";
import { arrayAt, valueAt } from "../src/core/json.ts";
import { cliJson, cliOutput, createProject, runCli } from "./fixtures/cli.ts";

const MINUTE = 60_000;

async function trackedProject() {
  const { home, project } = createProject();
  const location = { cwd: project, home };
  await runCli(["track", "7"], location);
  return location;
}

const holdOf = async (location: { cwd: string; home: string }) =>
  valueAt(arrayAt(await cliJson(["status", "--json"], location), "prs")[0], "hold");

describe("hold and unhold", () => {
  test("an offline hold on a tracked PR is recorded with its expiry and reason", async () => {
    const location = await trackedProject();
    const before = Date.now();
    expect(
      await cliOutput(["hold", "7", "--for", "45m", "--reason", "waiting on design"], location),
    ).toBe(
      "holding acme/widgets#7 for 45m: waiting on design (daemon not running; recorded for when it starts)",
    );
    const hold = await holdOf(location);
    expect(hold).toMatchObject({ reason: "waiting on design", scope: "pr" });
    const until = Number(valueAt(hold, "until"));
    expect(until - before).toBeGreaterThanOrEqual(45 * MINUTE);
    expect(until - before).toBeLessThan(46 * MINUTE);
  });

  test("status shows the hold and unhold releases it", async () => {
    const location = await trackedProject();
    await runCli(["hold", "7", "--reason", "lunch"], location);
    expect(await cliOutput(["status"], location)).toContain("  held 30m more: lunch");
    expect(await cliOutput(["unhold", "7"], location)).toBe("released the hold on acme/widgets#7");
    expect(await holdOf(location)).toBeNull();
  });

  test("hold all defaults to 30 minutes and unhold all releases it", async () => {
    const location = await trackedProject();
    expect(await cliOutput(["hold", "all"], location)).toStartWith(
      "holding every tracked PR for 30m",
    );
    expect(await cliOutput(["unhold", "all"], location)).toBe("released every hold");
    expect(await holdOf(location)).toBeNull();
  });

  test.each([
    ["longer than four hours", ["hold", "7", "--for", "5h"], "at most 4h"],
    ["an unreadable duration", ["hold", "7", "--for", "soon"], "not a duration"],
    ["an untracked PR", ["hold", "8"], "not tracked"],
  ])("refuses %s", async (label, args, message) => {
    const location = await trackedProject();
    const result = await runCli(args, location);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
