import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeliveryRequest } from "../src/channel/deliver.ts";
import { lastTransitionId } from "../src/channel/state.ts";
import { ChannelRelay } from "../src/channel/relay.ts";
import { Store } from "../src/daemon/store.ts";
import { BASE_TRANSITION } from "./fixtures/transition.ts";

const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const line = (id: number, number = 7) => JSON.stringify({ ...BASE_TRANSITION, id, number });
const lines = (...ids: number[]) => ids.map((id) => `${line(id)}\n`).join("");

function relayOver(content: string, after: number) {
  const logPath = join(mkdtempSync(join(tmpdir(), "apl-relay-")), "transitions.jsonl");
  writeFileSync(logPath, content);
  const requests: DeliveryRequest[] = [];
  const failures: string[] = [];
  const relay = new ChannelRelay({
    logPath,
    sessionId: "s1",
    cwd: "/nowhere",
    format: "monitor",
    after,
    emit: () => {},
    log: (message) => failures.push(message),
    deliver: async (request) => {
      requests.push(request);
      return request.lines.map((text) => ({ format: "monitor" as const, text }));
    },
  });
  relay.start();
  stops.push(() => relay.stop());
  const forwardedIds = () =>
    requests.flatMap((request) => request.lines.map((text) => JSON.parse(text).id));
  return { relay, logPath, requests, failures, forwardedIds };
}

describe("the relay forwards only transitions newer than its start", () => {
  test("a log rewound to the start never replays history", async () => {
    const { relay, logPath, forwardedIds } = relayOver(lines(1, 2, 3), 3);
    truncateSync(logPath, 0);
    appendFileSync(logPath, lines(1, 2, 3, 4));
    relay.poll();
    await relay.idle();
    expect(forwardedIds()).toEqual([4]);
  });

  test("history appended again after new transitions is still dropped", async () => {
    const { relay, logPath, forwardedIds } = relayOver(lines(1, 2), 2);
    appendFileSync(logPath, lines(3));
    relay.poll();
    await relay.idle();
    appendFileSync(logPath, lines(1, 2, 3, 4));
    relay.poll();
    await relay.idle();
    expect(forwardedIds()).toEqual([3, 4]);
  });

  test("transitions that arrive together are decided in one request", async () => {
    const { relay, logPath, requests } = relayOver("", 0);
    appendFileSync(logPath, lines(1, 2, 3));
    relay.poll();
    await relay.idle();
    expect(requests.map((request) => request.lines.length)).toEqual([3]);
  });

  test("lines that are not transitions are skipped", async () => {
    const { relay, logPath, forwardedIds } = relayOver("", 0);
    appendFileSync(logPath, `garbage\n${lines(1)}`);
    relay.poll();
    await relay.idle();
    expect(forwardedIds()).toEqual([1]);
  });

  test("a failed request is logged and the next one still goes out", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "apl-relay-")), "transitions.jsonl");
    writeFileSync(logPath, "");
    const emitted: string[] = [];
    const failures: string[] = [];
    const relay = new ChannelRelay({
      logPath,
      sessionId: "s1",
      cwd: "/nowhere",
      format: "monitor",
      after: 0,
      emit: (delivery) => emitted.push(delivery.format === "monitor" ? delivery.text : ""),
      log: (message) => failures.push(message),
      deliver: async (request) => {
        if (request.lines.some((text) => JSON.parse(text).id === 1)) throw new Error("boom");
        return [{ format: "monitor", text: "two" }];
      },
    });
    relay.start();
    stops.push(() => relay.stop());
    appendFileSync(logPath, lines(1));
    relay.poll();
    await relay.idle();
    appendFileSync(logPath, lines(2));
    relay.poll();
    await relay.idle();
    expect(emitted).toEqual(["two"]);
    expect(failures).toEqual(["skipping 1 transition(s): boom"]);
  });
});

describe("lastTransitionId", () => {
  test("is the newest transition the daemon stored", () => {
    const db = join(mkdtempSync(join(tmpdir(), "apl-relay-")), "state.db");
    const store = new Store(db);
    store.appendTransition({ ...BASE_TRANSITION }, 1);
    store.appendTransition({ ...BASE_TRANSITION }, 2);
    store.close();
    expect(lastTransitionId(db)).toBe(2);
  });

  test("is 0 before the daemon has stored anything", () => {
    const db = join(mkdtempSync(join(tmpdir(), "apl-relay-")), "state.db");
    expect(lastTransitionId(db)).toBe(0);
  });
});
