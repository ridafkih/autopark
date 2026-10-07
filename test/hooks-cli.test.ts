import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigSet } from "../src/daemon/config-set.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import { config, snap } from "./fixtures/build.ts";
import { ImmediateClock } from "./fixtures/clock.ts";
import { FakeGitHub } from "./fixtures/fake-github.ts";
import { RecordingRunner } from "./fixtures/harness.ts";

const ROOT = resolve(import.meta.dir, "..");
let stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const s of stops) await s();
  stops = [];
});

async function setup(configYaml = "repos:\n  - acme/widgets\n") {
  const dir = mkdtempSync(join(tmpdir(), "apl-hk-"));
  const home = join(dir, "home");
  const proj = join(dir, "proj");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, ".pr-autopilot.yaml"), configYaml);
  return { home, proj };
}

async function bootWithConflict(home: string) {
  const github = new FakeGitHub();
  github.set(snap({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));
  const configs = await ConfigSet.fromConfigs([{ config: config(), source: join(home, "x.yaml") }]);
  const d = await startDaemon({ configs, github, home, clock: new ImmediateClock(), source: new ReplaySource(), wake: null, runner: new RecordingRunner(), log: () => {} });
  stops.push(() => d.stop());
  d.engine.track("acme/widgets", 7, { sessionId: "s1" });
  await d.engine.idle();
  return d;
}

async function run(args: string[], o: { home: string; cwd: string; stdin?: string }) {
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli/main.ts"), ...args], {
    cwd: o.cwd,
    env: { ...process.env, PR_AUTOPILOT_HOME: o.home },
    stdin: o.stdin === undefined ? "ignore" : new TextEncoder().encode(o.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout: stdout.trim() };
}

test("stop hook blocks on a conflict up to the cap, then lets go", async () => {
  const { home, proj } = await setup();
  await bootWithConflict(home);
  const stop = (active: boolean) => run(["hook", "stop"], { home, cwd: proj, stdin: JSON.stringify({ session_id: "s1", cwd: proj, stop_hook_active: active, hook_event_name: "Stop" }) });
  const outputs = [];
  for (const active of [false, true, true, true]) outputs.push(JSON.parse((await stop(active)).stdout));
  expect(outputs.slice(0, 3).map((o) => o.decision)).toEqual(["block", "block", "block"]);
  expect(outputs[0].reason).toContain("acme/widgets#7 conflict: conflicts with main");
  expect(outputs[3]).toEqual({ systemMessage: expect.stringContaining("stopped blocking after 3") });
  const other = await run(["hook", "stop"], { home, cwd: proj, stdin: JSON.stringify({ session_id: "s2", cwd: proj, stop_hook_active: false }) });
  expect(other).toEqual({ code: 0, stdout: "" });
}, 30_000);

test("session start injects daemon state, tracked PRs and actionable items", async () => {
  const { home, proj } = await setup();
  await bootWithConflict(home);
  const r = await run(["hook", "session-start"], { home, cwd: proj, stdin: JSON.stringify({ session_id: "s1", cwd: proj, source: "startup" }) });
  const out = JSON.parse(r.stdout);
  expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(out.hookSpecificOutput.additionalContext).toContain(`pr-autopilot daemon is running (pid ${process.pid}, replay connected).`);
  expect(out.hookSpecificOutput.additionalContext).toContain("Actionable now:\n- acme/widgets#7 conflict");
});

test("hooks never fail the session on bad input", async () => {
  const { home, proj } = await setup();
  expect(await run(["hook", "stop"], { home, cwd: proj, stdin: "{not json" })).toEqual({ code: 0, stdout: "" });
});

test("watch prints one line per in-scope transition", async () => {
  const { home, proj } = await setup("repos:\n  - acme/widgets\ndelivery:\n  monitor: always\n");
  mkdirSync(home, { recursive: true });
  const log = join(home, "transitions.jsonl");
  writeFileSync(log, "");
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli/main.ts"), "watch"], { cwd: proj, env: { ...process.env, PR_AUTOPILOT_HOME: home }, stdout: "pipe", stderr: "pipe" });
  stops.push(async () => void proc.kill());
  const errReader = proc.stderr.getReader();
  await errReader.read();
  const line = (id: number, repo: string) =>
    JSON.stringify({ id, ts: "", kind: "checks_failed", repo, number: 7, head: "1".repeat(40), reason: "required failed: build (FAILURE)", data: {}, title: "T", url: `https://github.com/${repo}/pull/7` }) + "\n";
  appendFileSync(log, line(1, "acme/other"));
  appendFileSync(log, line(2, "acme/widgets"));
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value).trim()).toBe("pr-autopilot acme/widgets#7 checks_failed head=1111111: required failed: build (FAILURE) https://github.com/acme/widgets/pull/7");
});

test("ship-context never fails and reports missing pieces", async () => {
  const { home, proj } = await setup();
  const r = await run(["ship-context"], { home, cwd: proj });
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("- Daemon: not running");
});
