import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_EVENTS,
  forwardArgs,
  GhWebhookForwardSource,
} from "../src/sources/gh-webhook-forward.ts";
import { signature } from "../src/sources/receiver.ts";
import { FakeClock, flush } from "./fixtures/clock.ts";
import { childAt, FakeChild } from "./fixtures/fake-child.ts";
import { recordingContext } from "./fixtures/source-context.ts";

interface ListeningSource {
  server: { port: number } | null;
}

const SECRET = "s3cret";
const BODY = JSON.stringify({ zen: "hi", repository: { full_name: "acme/widgets" } });
const CONNECTED_LINE = "Forwarding Webhook events from GitHub...";
const OPTIONS = {
  gh: "gh",
  events: DEFAULT_EVENTS,
  hostname: "127.0.0.1",
  path: "/github",
  restartBackoffMs: [1000, 5000],
};

const started: GhWebhookForwardSource[] = [];

afterEach(async () => {
  for (const source of started.splice(0)) await source.stop();
});

async function startForwarder(repos = ["acme/widgets"]) {
  const clock = new FakeClock();
  const children: FakeChild[] = [];
  const source = new GhWebhookForwardSource(OPTIONS, {
    clock,
    port: 8787,
    secret: SECRET,
    listen: false,
    spawn: (command) => {
      const child = new FakeChild(command);
      children.push(child);
      return child;
    },
  });
  started.push(source);
  const recorder = recordingContext(repos);
  await source.start(recorder.context);
  await flush();
  const childrenAfter = async (durationMs: number) => {
    await clock.advance(durationMs);
    return children.length;
  };
  return { clock, children, recorder, source, childrenAfter };
}

function postPing(port: number, id: string, signatureHeader: string) {
  return fetch(`http://127.0.0.1:${port}/github`, {
    method: "POST",
    headers: {
      "x-github-delivery": id,
      "x-github-event": "ping",
      "x-hub-signature-256": signatureHeader,
    },
    body: BODY,
  });
}

describe("gh-webhook-forward source", () => {
  test("builds the forward command per repo", () => {
    expect(forwardArgs(OPTIONS, "acme/widgets", 8787, SECRET)).toEqual([
      "gh",
      "webhook",
      "forward",
      "--repo=acme/widgets",
      `--events=${DEFAULT_EVENTS.join(",")}`,
      "--url=http://127.0.0.1:8787/github",
      `--secret=${SECRET}`,
    ]);
  });

  test("spawns one forwarder per repo", async () => {
    const forwarder = await startForwarder(["acme/widgets", "acme/gadgets"]);
    expect(forwarder.children.map((child) => child.command[3])).toEqual([
      "--repo=acme/widgets",
      "--repo=acme/gadgets",
    ]);
    expect(forwarder.source.status().state).toBe("connecting");
  });

  test("every connect line triggers a resync, including internal reconnects", async () => {
    const forwarder = await startForwarder();
    childAt(forwarder.children, 0).emit(CONNECTED_LINE);
    await flush();
    expect(forwarder.source.status().state).toBe("connected");
    childAt(forwarder.children, 0).emit(CONNECTED_LINE);
    await flush();
    expect(forwarder.recorder.reconnects).toHaveLength(2);
  });

  test("restarts a dead forwarder with backoff on the injected clock", async () => {
    const forwarder = await startForwarder();
    const first = childAt(forwarder.children, 0);
    first.emit("error: unable to connect to webhooks server, forwarding stopped");
    first.exit(1);
    await flush();
    expect(forwarder.source.status().state).toBe("disconnected");
    expect(forwarder.source.status().detail).toContain("unable to connect");
    expect(forwarder.children).toHaveLength(1);
    expect(await forwarder.childrenAfter(999)).toBe(1);
    expect(await forwarder.childrenAfter(1)).toBe(2);
    childAt(forwarder.children, 1).exit(1);
    expect(await forwarder.childrenAfter(4999)).toBe(2);
    expect(await forwarder.childrenAfter(1)).toBe(3);
    expect(forwarder.clock.sleeps).toEqual([1000, 5000]);
  });

  test("a successful connect resets the backoff", async () => {
    const forwarder = await startForwarder();
    childAt(forwarder.children, 0).exit(1);
    await forwarder.clock.advance(1000);
    const second = childAt(forwarder.children, 1);
    second.emit(CONNECTED_LINE);
    second.exit(1);
    await forwarder.clock.advance(1000);
    expect(forwarder.children).toHaveLength(3);
    expect(forwarder.clock.sleeps).toEqual([1000, 1000]);
  });

  test("stop kills children and does not restart them", async () => {
    const forwarder = await startForwarder();
    await forwarder.source.stop();
    await forwarder.source.settled();
    expect(childAt(forwarder.children, 0).isKilled).toBe(true);
    expect(forwarder.children).toHaveLength(1);
    expect(forwarder.source.status().state).toBe("stopped");
  });

  test("the real receiver verifies HMAC end to end over HTTP", async () => {
    const source = new GhWebhookForwardSource(
      { ...OPTIONS },
      {
        clock: new FakeClock(),
        port: 0,
        secret: SECRET,
        spawn: (command) => new FakeChild(command),
      },
    );
    started.push(source);
    const recorder = recordingContext([]);
    await source.start(recorder.context);
    const port = (source as unknown as ListeningSource).server?.port ?? 0;
    const accepted = await postPing(port, "h1", signature(SECRET, BODY));
    const rejected = await postPing(port, "h2", "sha256=00");
    expect([accepted.status, rejected.status]).toEqual([202, 401]);
    expect(recorder.deliveries.map((delivery) => delivery.id)).toEqual(["h1"]);
  });
});
