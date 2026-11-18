import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/daemon/store.ts";
import { BASE_TRANSITION } from "./fixtures/transition.ts";

const ENTRY = resolve(import.meta.dir, "../src/channel/deliver.ts");

function home() {
  const directory = mkdtempSync(join(tmpdir(), "apl-deliver-process-"));
  const autoparkHome = join(directory, "home");
  const cwd = join(directory, "proj");
  mkdirSync(autoparkHome, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const store = new Store(join(autoparkHome, "state.db"));
  store.track({ repo: "acme/widgets", number: 7, source: "explicit", sessionId: "s1", now: 1 });
  store.close();
  return { autoparkHome, cwd };
}

async function runDeliver(request: Record<string, unknown>) {
  const { autoparkHome, cwd } = home();
  const subprocess = Bun.spawn([process.execPath, ENTRY], {
    cwd,
    env: { ...process.env, AUTOPARK_HOME: autoparkHome },
    stdin: new TextEncoder().encode(JSON.stringify({ ...request, cwd })),
    stdout: "pipe",
  });
  const [stdout] = await Promise.all([new Response(subprocess.stdout).text(), subprocess.exited]);
  return stdout;
}

const line = (number: number) =>
  JSON.stringify({ ...BASE_TRANSITION, kind: "checks_failed", number });
const base = { sessionId: "s1", format: "monitor" };

describe("the delivery process", () => {
  test("a batch request gets back a list of deliveries", async () => {
    const stdout = await runDeliver({ ...base, lines: [line(7), line(8)] });
    expect(JSON.parse(stdout)).toHaveLength(1);
  });

  test("a single-line request from a relay started before batching gets one delivery", async () => {
    const stdout = await runDeliver({ ...base, line: line(7) });
    expect(JSON.parse(stdout)).toMatchObject({ format: "monitor" });
  });

  test("a single-line request for another session's PR gets nothing", async () => {
    expect(await runDeliver({ ...base, line: line(8) })).toBe("");
  });
});
