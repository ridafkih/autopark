import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_EVENTS, GhWebhookForwardSource } from "../src/sources/gh-webhook-forward.ts";
import { FakeClock, flush } from "./fixtures/clock.ts";
import { childAt, FakeChild } from "./fixtures/fake-child.ts";
import { recordingContext } from "./fixtures/source-context.ts";

const CONNECTED_LINE = "Forwarding Webhook events from GitHub...";
const OPTIONS = {
  gh: "gh",
  events: DEFAULT_EVENTS,
  hostname: "127.0.0.1",
  path: "/github",
  restartBackoffMs: [1000],
};

const started: GhWebhookForwardSource[] = [];

afterEach(async () => {
  for (const source of started.splice(0)) await source.stop();
});

async function startForwarder(repos: string[]) {
  const clock = new FakeClock();
  const children: FakeChild[] = [];
  const source = new GhWebhookForwardSource(OPTIONS, {
    clock,
    port: 8787,
    secret: "s",
    listen: false,
    spawn: (command) => {
      const child = new FakeChild(command);
      children.push(child);
      return child;
    },
  });
  started.push(source);
  await source.start(recordingContext(repos).context);
  await flush();
  return { clock, children, source };
}

describe("gh-webhook-forward status", () => {
  test("a reconnect clears the previous error and records when it connected", async () => {
    const forwarder = await startForwarder(["acme/widgets"]);
    const first = childAt(forwarder.children, 0);
    first.emit(CONNECTED_LINE);
    first.emit("Error: error receiving json event: websocket: close 1006 (abnormal closure)");
    first.exit(1);
    await flush();
    expect(forwarder.source.status()).toMatchObject({ state: "disconnected", lastConnectedAt: 0 });
    expect(forwarder.source.status().detail).toContain("1006");
    await forwarder.clock.advance(1000);
    childAt(forwarder.children, 1).emit(CONNECTED_LINE);
    await flush();
    expect(forwarder.source.status()).toMatchObject({
      state: "connected",
      detail: "",
      lastConnectedAt: 1000,
      lastDeliveryAt: null,
    });
  });

  test("a reconnect keeps another repo's error", async () => {
    const forwarder = await startForwarder(["acme/widgets", "acme/gadgets"]);
    childAt(forwarder.children, 1).emit("error: unable to connect to webhooks server");
    childAt(forwarder.children, 0).emit(CONNECTED_LINE);
    await flush();
    expect(forwarder.source.status().detail).toContain("acme/gadgets: error: unable to connect");
  });
});
