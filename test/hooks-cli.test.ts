import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigSet } from "../src/daemon/config-set.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import { config, snapshot } from "./fixtures/build.ts";
import { FakeGitHub } from "./fixtures/fake-github.ts";
import { RecordingRunner } from "./fixtures/harness.ts";
import { ImmediateClock } from "./fixtures/immediate-clock.ts";
import { parseJson, stringAt, valueAt } from "../src/core/json.ts";

interface RunOptions {
  home: string;
  cwd: string;
  stdin?: string;
}

const ROOT = resolve(import.meta.dir, "..");
const CLI = join(ROOT, "src/cli/main.ts");
const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function setup(configYaml = "repos:\n  - acme/widgets\n") {
  const directory = mkdtempSync(join(tmpdir(), "apl-hk-"));
  const home = join(directory, "home");
  const project = join(directory, "proj");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, ".autopark.yaml"), configYaml);
  return { home, project };
}

async function bootWithConflict(home: string) {
  const github = new FakeGitHub();
  github.set(snapshot({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));
  const configs = await ConfigSet.fromConfigs([{ config: config(), source: join(home, "x.yaml") }]);
  const daemon = await startDaemon({
    configs,
    github,
    home,
    clock: new ImmediateClock(),
    source: new ReplaySource(),
    wake: null,
    runner: new RecordingRunner(),
    log: () => {},
  });
  stops.push(() => daemon.stop());
  daemon.engine.track("acme/widgets", 7, { sessionId: "s1" });
  await daemon.engine.idle();
  return daemon;
}

async function run(args: string[], options: RunOptions) {
  const subprocess = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: options.cwd,
    env: { ...process.env, AUTOPARK_HOME: options.home },
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);
  return { code, stdout: stdout.trim() };
}

function transitionLine(id: number, repo: string) {
  const transition = {
    id,
    ts: "",
    kind: "checks_failed",
    repo,
    number: 7,
    head: "1".repeat(40),
    reason: "required failed: build (FAILURE)",
    data: {},
    title: "T",
    url: `https://github.com/${repo}/pull/7`,
  };
  return `${JSON.stringify(transition)}\n`;
}

test("stop hook blocks on a conflict up to the cap, then lets go", async () => {
  const { home, project } = setup();
  await bootWithConflict(home);
  const stop = async (isActive: boolean) => {
    const stdin = JSON.stringify({
      session_id: "s1",
      cwd: project,
      stop_hook_active: isActive,
      hook_event_name: "Stop",
    });
    const result = await run(["hook", "stop"], { home, cwd: project, stdin });
    return parseJson(result.stdout);
  };
  const outputs: unknown[] = [];
  for (const isActive of [false, true, true, true]) outputs.push(await stop(isActive));
  const decisions = outputs.slice(0, 3).map((output) => stringAt(output, "decision"));
  expect(decisions).toEqual(["block", "block", "block"]);
  expect(stringAt(outputs[0], "reason")).toContain("acme/widgets#7 conflict: conflicts with main");
  expect(outputs[3]).toEqual({
    systemMessage: expect.stringContaining("stopped blocking after 3"),
  });
  const other = await run(["hook", "stop"], {
    home,
    cwd: project,
    stdin: JSON.stringify({ session_id: "s2", cwd: project, stop_hook_active: false }),
  });
  expect(other).toEqual({ code: 0, stdout: "" });
}, 30_000);

test("session start injects daemon state, tracked PRs and actionable items", async () => {
  const { home, project } = setup();
  await bootWithConflict(home);
  const result = await run(["hook", "session-start"], {
    home,
    cwd: project,
    stdin: JSON.stringify({ session_id: "s1", cwd: project, source: "startup" }),
  });
  const hookSpecificOutput = valueAt(parseJson(result.stdout), "hookSpecificOutput");
  const additionalContext = stringAt(hookSpecificOutput, "additionalContext");
  expect(stringAt(hookSpecificOutput, "hookEventName")).toBe("SessionStart");
  expect(additionalContext).toContain(
    `autopark daemon is running (pid ${process.pid}, replay connected).`,
  );
  expect(additionalContext).toContain("Actionable now:\n- acme/widgets#7 conflict");
});

test("hooks never fail the session on bad input", async () => {
  const { home, project } = setup();
  expect(await run(["hook", "stop"], { home, cwd: project, stdin: "{not json" })).toEqual({
    code: 0,
    stdout: "",
  });
});

test("watch prints one line per in-scope transition", async () => {
  const { home, project } = setup("repos:\n  - acme/widgets\ndelivery:\n  monitor: always\n");
  mkdirSync(home, { recursive: true });
  const log = join(home, "transitions.jsonl");
  writeFileSync(log, "");
  const subprocess = Bun.spawn([process.execPath, CLI, "watch"], {
    cwd: project,
    env: { ...process.env, AUTOPARK_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  stops.push(async () => {
    subprocess.kill();
  });
  const errorReader = subprocess.stderr.getReader();
  await errorReader.read();
  appendFileSync(log, transitionLine(1, "acme/other"));
  appendFileSync(log, transitionLine(2, "acme/widgets"));
  const reader = subprocess.stdout.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value).trim()).toBe(
    "autopark acme/widgets#7 checks_failed head=1111111: required failed: build (FAILURE) https://github.com/acme/widgets/pull/7",
  );
});

test("ship-context never fails and reports missing pieces", async () => {
  const { home, project } = setup();
  const result = await run(["ship-context"], { home, cwd: project });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("- Daemon: not running");
});
