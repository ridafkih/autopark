import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  codeStamp,
  liveDeliveries,
  removeHeartbeat,
  writeHeartbeat,
  type Heartbeat,
} from "../src/channel/heartbeat.ts";
import { resolvePaths } from "../src/daemon/paths.ts";
import { Store } from "../src/daemon/store.ts";
import { hookState as readHookState } from "../src/hooks/run.ts";
import { DELIVERY_DOWN, stopHook } from "../src/hooks/stop.ts";
import { stringAt } from "../src/core/json.ts";
import { hookState, view } from "./fixtures/hook-state.ts";

const CLI = join(resolve(import.meta.dir, ".."), "src/cli/main.ts");
const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const temporaryPaths = () => resolvePaths(mkdtempSync(join(tmpdir(), "apl-beat-")));

const isProcessAlive = (pid: number) => pid !== 15;

const beat = (changes: Partial<Heartbeat> = {}): Heartbeat => ({
  kind: "channel",
  pid: 11,
  sessionId: "s1",
  stamp: "current",
  startedAt: 1,
  ...changes,
});

describe("delivery heartbeats", () => {
  test("only live deliveries for the session running current code count", () => {
    const paths = temporaryPaths();
    writeHeartbeat(paths, beat());
    writeHeartbeat(paths, beat({ pid: 12, sessionId: "s2" }));
    writeHeartbeat(paths, beat({ pid: 13, stamp: "old" }));
    writeHeartbeat(paths, beat({ pid: 14, kind: "monitor" }));
    writeHeartbeat(paths, beat({ pid: 15 }));
    const live = liveDeliveries(paths, { sessionId: "s1", stamp: "current", isProcessAlive });
    expect(live.map((heartbeat) => heartbeat.pid).toSorted()).toEqual([11, 14]);
  });

  test("a removed heartbeat no longer counts", () => {
    const paths = temporaryPaths();
    writeHeartbeat(paths, beat());
    removeHeartbeat(paths, "channel", 11);
    expect(
      liveDeliveries(paths, { sessionId: "s1", stamp: "current", isProcessAlive: () => true }),
    ).toEqual([]);
  });

  test("the code stamp changes when delivery code changes", () => {
    const root = mkdtempSync(join(tmpdir(), "apl-stamp-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/relay.ts"), "one");
    const before = codeStamp(root, ["src/relay.ts"]);
    expect(codeStamp(root, ["src/relay.ts"])).toBe(before);
    writeFileSync(join(root, "src/relay.ts"), "two");
    expect(codeStamp(root, ["src/relay.ts"])).not.toBe(before);
  });
});

describe("Stop hook when nothing can wake the session", () => {
  test("blocks with the monitor instruction even when no PR needs action", () => {
    const result = stopHook({
      ...hookState({ isDeliveryLive: false }),
      stopHookActive: false,
      priorBlocks: 0,
    });
    expect(result.output).toMatchObject({ decision: "block" });
    expect(stringAt(result.output, "reason")).toBe(DELIVERY_DOWN);
    expect(result.blocks).toBe(1);
  });

  test("lists the PR actions after the delivery warning", () => {
    const result = stopHook({
      ...hookState({ isDeliveryLive: false, views: [view({ mergeable: "CONFLICTING" })] }),
      stopHookActive: false,
      priorBlocks: 0,
    });
    expect(stringAt(result.output, "reason")).toBe(
      `${DELIVERY_DOWN}\nAct on these PRs per the autopark playbook; only \`autopark hold\` pauses PR work.\n#7 conflict`,
    );
  });

  test("is never answered with a no-change brief", () => {
    const state = {
      ...hookState({ isDeliveryLive: false }),
      stopHookActive: false,
      priorBlocks: 0,
    };
    const first = stopHook(state);
    const second = stopHook({ ...state, priorBrief: first.brief });
    expect(stringAt(second.output, "reason")).toBe(DELIVERY_DOWN);
  });

  test("lets go with a message at the continuation cap", () => {
    const result = stopHook({
      ...hookState({ isDeliveryLive: false }),
      stopHookActive: true,
      priorBlocks: 3,
    });
    expect(result.output).toEqual({ systemMessage: DELIVERY_DOWN });
  });

  test("stays quiet for a session that drives no PRs", () => {
    const result = stopHook({
      ...hookState({ isDeliveryLive: false, views: [view({}, "s2")] }),
      stopHookActive: false,
      priorBlocks: 0,
    });
    expect(result.output).toBeNull();
  });

  test("reads delivery liveness for the hook's session from heartbeats", async () => {
    const paths = temporaryPaths();
    process.env.AUTOPARK_HOME = paths.home;
    stops.push(() => delete process.env.AUTOPARK_HOME);
    const isLive = async () => {
      const state = await readHookState({ cwd: paths.home, session_id: "s1" }, paths);
      return state.isDeliveryLive;
    };
    expect(await isLive()).toBe(false);
    writeHeartbeat(paths, beat({ pid: process.pid, stamp: codeStamp() }));
    expect(await isLive()).toBe(true);
    writeHeartbeat(paths, beat({ pid: process.pid, stamp: "old" }));
    expect(await isLive()).toBe(false);
  });
});

function transitionLine(id: number) {
  const transition = {
    id,
    ts: "",
    kind: "approval_needed",
    repo: "acme/widgets",
    number: 7,
    head: "1".repeat(40),
    reason: `event ${id}`,
    data: {},
    title: "T",
    url: "https://github.com/acme/widgets/pull/7",
  };
  return `${JSON.stringify(transition)}\n`;
}

function spawnWatch(paths: ReturnType<typeof resolvePaths>, project: string, flags: string[] = []) {
  const subprocess = Bun.spawn([process.execPath, CLI, "watch", ...flags], {
    cwd: project,
    env: { ...process.env, AUTOPARK_HOME: paths.home, CLAUDE_CODE_SESSION_ID: "s1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  stops.push(() => subprocess.kill());
  return subprocess;
}

function watchSetup(configYaml = "repos:\n  - acme/elsewhere\n") {
  const directory = mkdtempSync(join(tmpdir(), "apl-watch-live-"));
  const paths = resolvePaths(join(directory, "home"));
  const project = join(directory, "proj");
  mkdirSync(project, { recursive: true });
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(join(project, ".autopark.yaml"), configYaml);
  const store = new Store(paths.db);
  store.track({ repo: "acme/widgets", number: 7, source: "explicit", sessionId: "s1", now: 1 });
  store.close();
  writeFileSync(paths.log, "");
  return { paths, project };
}

describe("watch in auto mode", () => {
  test("stands down only while a live channel on current code delivers to its session", async () => {
    const { paths, project } = watchSetup();
    writeHeartbeat(paths, beat({ pid: process.pid, stamp: codeStamp() }));
    const subprocess = spawnWatch(paths, project);
    const stderr = subprocess.stderr.getReader();
    await stderr.read();
    appendFileSync(paths.log, transitionLine(1));
    const { value: skipped } = await stderr.read();
    expect(new TextDecoder().decode(skipped)).toContain("a live channel delivered this transition");
    rmSync(join(paths.deliveries, `channel-${process.pid}.json`));
    appendFileSync(paths.log, transitionLine(2));
    const { value } = await subprocess.stdout.getReader().read();
    const lines = new TextDecoder().decode(value).trim().split("\n");
    expect(lines).toEqual([
      "autopark acme/widgets#7 approval_needed head=1111111: event 2 https://github.com/acme/widgets/pull/7",
    ]);
    const live = liveDeliveries(paths, { sessionId: "s1", stamp: codeStamp() });
    expect(live.map((heartbeat) => [heartbeat.kind, heartbeat.pid])).toEqual([
      ["monitor", subprocess.pid],
    ]);
  });

  test("--fallback delivers even when the config turns the monitor off", async () => {
    const { paths, project } = watchSetup(
      "repos:\n  - acme/elsewhere\ndelivery:\n  monitor: off\n",
    );
    const subprocess = spawnWatch(paths, project, ["--fallback"]);
    await subprocess.stderr.getReader().read();
    appendFileSync(paths.log, transitionLine(3));
    const { value } = await subprocess.stdout.getReader().read();
    expect(new TextDecoder().decode(value).trim()).toBe(
      "autopark acme/widgets#7 approval_needed head=1111111: event 3 https://github.com/acme/widgets/pull/7",
    );
  });
});
