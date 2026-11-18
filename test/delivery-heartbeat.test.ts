import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveriesFor, type DeliveryRequest } from "../src/channel/deliver.ts";
import {
  liveDeliveries,
  removeHeartbeat,
  writeHeartbeat,
  type Heartbeat,
} from "../src/channel/heartbeat.ts";
import { resolvePaths } from "../src/daemon/paths.ts";
import { Store } from "../src/daemon/store.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const isProcessAlive = (pid: number) => pid !== 15;

const beat = (changes: Partial<Heartbeat> = {}): Heartbeat => ({
  kind: "channel",
  pid: 11,
  sessionId: "s1",
  startedAt: 1,
  ...changes,
});

function project() {
  const directory = mkdtempSync(join(tmpdir(), "apl-deliver-"));
  const paths = resolvePaths(join(directory, "home"));
  const cwd = join(directory, "proj");
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const store = new Store(paths.db);
  store.track({ repo: "acme/widgets", number: 7, source: "explicit", sessionId: "s1", now: 1 });
  store.track({ repo: "acme/widgets", number: 8, source: "explicit", sessionId: "s2", now: 1 });
  store.close();
  return { paths, cwd };
}

const writeConfig = (cwd: string, yaml: string) => writeFileSync(join(cwd, ".autopark.yaml"), yaml);

const transitionLine = (number: number) =>
  JSON.stringify({
    id: number,
    ts: "",
    kind: "checks_failed",
    repo: "acme/widgets",
    number,
    head: "1".repeat(40),
    reason: `build failed ${number}`,
    data: {},
    title: "T",
    url: `https://github.com/acme/widgets/pull/${number}`,
  });

const request = (cwd: string, changes: Partial<DeliveryRequest> = {}): DeliveryRequest => ({
  lines: [transitionLine(7)],
  sessionId: "s1",
  cwd,
  format: "channel",
  ...changes,
});

describe("delivery heartbeats", () => {
  test("only live deliveries for the session count", () => {
    const { paths } = project();
    writeHeartbeat(paths, beat());
    writeHeartbeat(paths, beat({ pid: 12, sessionId: "s2" }));
    writeHeartbeat(paths, beat({ pid: 14, kind: "monitor" }));
    writeHeartbeat(paths, beat({ pid: 15 }));
    const live = liveDeliveries(paths, { sessionId: "s1", isProcessAlive });
    expect(live.map((heartbeat) => heartbeat.pid).toSorted()).toEqual([11, 14]);
  });

  test("a removed heartbeat no longer counts", () => {
    const { paths } = project();
    writeHeartbeat(paths, beat());
    removeHeartbeat(paths, "channel", 11);
    expect(liveDeliveries(paths, { sessionId: "s1", isProcessAlive })).toEqual([]);
  });
});

describe("each transition is decided against current state", () => {
  test("a PR the session drives is delivered with no config at all", async () => {
    const { paths, cwd } = project();
    const deliveries = await deliveriesFor(request(cwd), paths);
    expect(deliveries).toMatchObject([
      { format: "channel", meta: { pr: "7", kind: "checks_failed" } },
    ]);
  });

  test("a config written after the channel started applies to the next transition", async () => {
    const { paths, cwd } = project();
    writeConfig(cwd, "repos:\n  - acme/widgets\ndelivery:\n  channel: false\n");
    expect(await deliveriesFor(request(cwd), paths)).toEqual([]);
    writeConfig(cwd, "repos:\n  - acme/widgets\n");
    expect(await deliveriesFor(request(cwd), paths)).toMatchObject([{ meta: { pr: "7" } }]);
  });

  test("another session's PR never reaches this session, even in a configured repo", async () => {
    const { paths, cwd } = project();
    writeConfig(cwd, "repos:\n  - acme/widgets\n");
    const other = request(cwd, { lines: [transitionLine(8)] });
    expect(await deliveriesFor(other, paths)).toEqual([]);
  });

  test("the monitor stands down only while a live channel delivers to its session", async () => {
    const { paths, cwd } = project();
    const monitor = request(cwd, { format: "monitor" });
    expect(await deliveriesFor(monitor, paths)).toEqual([
      {
        format: "monitor",
        text: "autopark acme/widgets#7 checks_failed head=1111111: build failed 7 https://github.com/acme/widgets/pull/7",
      },
    ]);
    writeHeartbeat(paths, beat({ pid: process.pid }));
    expect(await deliveriesFor(monitor, paths)).toEqual([]);
    removeHeartbeat(paths, "channel", process.pid);
    writeHeartbeat(paths, beat({ pid: process.pid, sessionId: "s2" }));
    expect(await deliveriesFor(monitor, paths)).not.toEqual([]);
  });
});
