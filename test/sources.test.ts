import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signature, verifySignature, webhookHandler } from "../src/sources/receiver.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import {
  DEFAULT_EVENTS,
  forwardArgs,
  GhWebhookForwardSource,
} from "../src/sources/gh-webhook-forward.ts";
import { createSource } from "../src/sources/index.ts";
import type { ChildHandle, SourceContext } from "../src/sources/types.ts";
import type { Delivery } from "../src/daemon/engine.ts";
import { FakeClock, flush } from "./fixtures/clock.ts";

const SECRET = "s3cret";
const body = JSON.stringify({ zen: "hi", repository: { full_name: "acme/widgets" } });

function req(opts: {
  method?: string;
  path?: string;
  sig?: string | null;
  id?: string | null;
  event?: string | null;
  body?: string;
  type?: string;
}) {
  const headers: Record<string, string> = { "content-type": opts.type ?? "application/json" };
  const b = opts.body ?? body;
  const sig = opts.sig === undefined ? signature(SECRET, b) : opts.sig;
  if (sig !== null) headers["x-hub-signature-256"] = sig;
  if (opts.id !== null) headers["x-github-delivery"] = opts.id ?? "d1";
  if (opts.event !== null) headers["x-github-event"] = opts.event ?? "ping";
  return new Request(`http://127.0.0.1${opts.path ?? "/github"}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.method === "GET" ? undefined : b,
  });
}

describe("webhook receiver", () => {
  test.each([
    ["valid signature", {}, SECRET, 202],
    ["wrong signature", { sig: "sha256=deadbeef" }, SECRET, 401],
    ["missing signature", { sig: null }, SECRET, 401],
    ["signature over a different body", { sig: signature(SECRET, "{}") }, SECRET, 401],
    ["no secret configured accepts unsigned", { sig: null }, null, 202],
    ["missing delivery id", { id: null }, SECRET, 400],
    ["missing event header", { event: null }, SECRET, 400],
    ["invalid json", { body: "{nope", sig: signature(SECRET, "{nope") }, SECRET, 400],
    [
      "form encoded payload",
      {
        body: `payload=${encodeURIComponent(body)}`,
        type: "application/x-www-form-urlencoded",
        sig: signature(SECRET, `payload=${encodeURIComponent(body)}`),
      },
      SECRET,
      202,
    ],
    ["wrong path", { path: "/other" }, SECRET, 404],
    ["wrong method", { method: "GET" }, SECRET, 405],
  ] as const)("%s", async (_l, o, secret, status) => {
    const got: Delivery[] = [];
    const res = await webhookHandler({ secret, path: "/github", deliver: (d) => got.push(d) })(
      req(o),
    );
    expect(res.status).toBe(status);
    expect(got.length).toBe(status === 202 ? 1 : 0);
    if (status === 202)
      expect(got[0]).toMatchObject({ id: "d1", event: "ping", payload: { zen: "hi" } });
  });

  test("delivery errors surface as 500 so the sender can retry", async () => {
    const res = await webhookHandler({
      secret: null,
      path: "/github",
      deliver: () => {
        throw new Error("db locked");
      },
    })(req({ sig: null }));
    expect(res.status).toBe(500);
  });

  test("signature helper matches GitHub's documented example", () => {
    expect(signature("It's a Secret to Everybody", "Hello, World!")).toBe(
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    );
    expect(
      verifySignature(
        "It's a Secret to Everybody",
        "Hello, World!",
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      ),
    ).toBe(true);
  });
});

function ctx(repos: string[] = ["acme/widgets"]) {
  const deliveries: Delivery[] = [];
  const reconnects: string[] = [];
  const logs: string[] = [];
  const c: SourceContext = {
    repos,
    deliver: async (d) => deliveries.push(d),
    reconnected: (r) => reconnects.push(r),
    log: (m) => logs.push(m),
  };
  return { c, deliveries, reconnects, logs };
}

describe("replay source", () => {
  test("delivers inline and file deliveries in order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apl-"));
    const file = join(dir, "d.jsonl");
    writeFileSync(
      file,
      '{"id":"f1","event":"ping","payload":{}}\n\n{"id":"f2","event":"ping","payload":{}}\n',
    );
    const src = new ReplaySource({ file, deliveries: [{ id: "i1", event: "ping", payload: {} }] });
    const x = ctx();
    await src.start(x.c);
    expect(x.deliveries.map((d) => d.id)).toEqual(["i1", "f1", "f2"]);
    src.reconnect("test");
    expect(x.reconnects).toEqual(["test"]);
    expect(src.status()).toMatchObject({ name: "replay", state: "connected" });
  });

  test("registry builds a replay source with a path relative to the config", async () => {
    const src = await createSource(
      "replay",
      { file: "x.jsonl" },
      {
        clock: new FakeClock(),
        port: 0,
        secret: "",
        spawn: () => {
          throw new Error("no");
        },
        baseDir: "/cfg",
      },
    );
    expect(src.name).toBe("replay");
  });

  test("unknown source ids fail loudly", async () => {
    await expect(
      createSource(
        "smoke-signals",
        {},
        {
          clock: new FakeClock(),
          port: 0,
          secret: "",
          spawn: () => {
            throw new Error("no");
          },
          baseDir: "/",
        },
      ),
    ).rejects.toThrow(/smoke-signals/);
  });
});

class FakeChild implements ChildHandle {
  private pending: string[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  private resolveExit!: (code: number) => void;
  exited = new Promise<number>((r) => (this.resolveExit = r));
  killed = false;
  constructor(readonly cmd: string[]) {}
  emit(line: string) {
    this.pending.push(line);
    this.wake?.();
  }
  exit(code: number) {
    this.done = true;
    this.wake?.();
    this.resolveExit(code);
  }
  kill() {
    this.killed = true;
    this.exit(143);
  }
  lines = (async function* (self: FakeChild) {
    for (;;) {
      if (self.pending.length) {
        yield self.pending.shift()!;
        continue;
      }
      if (self.done) return;
      await new Promise<void>((r) => (self.wake = r));
      self.wake = null;
    }
  })(this);
}

describe("gh-webhook-forward source", () => {
  const opts = {
    gh: "gh",
    events: DEFAULT_EVENTS,
    hostname: "127.0.0.1",
    path: "/github",
    restartBackoffMs: [1000, 5000],
  };
  let src: GhWebhookForwardSource | null = null;
  afterEach(async () => {
    await src?.stop();
    src = null;
  });

  function setup(repos = ["acme/widgets"]) {
    const clock = new FakeClock();
    const children: FakeChild[] = [];
    src = new GhWebhookForwardSource(opts, {
      clock,
      port: 8787,
      secret: SECRET,
      listen: false,
      spawn: (cmd) => {
        const c = new FakeChild(cmd);
        children.push(c);
        return c;
      },
    });
    const x = ctx(repos);
    return { clock, children, x, src };
  }

  test("builds the forward command per repo", () => {
    expect(forwardArgs(opts, "acme/widgets", 8787, SECRET)).toEqual([
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
    const s = setup(["acme/widgets", "acme/gadgets"]);
    await s.src.start(s.x.c);
    await flush();
    expect(s.children.map((c) => c.cmd[3])).toEqual(["--repo=acme/widgets", "--repo=acme/gadgets"]);
    expect(s.src.status().state).toBe("connecting");
  });

  test("every connect line triggers a resync, including internal reconnects", async () => {
    const s = setup();
    await s.src.start(s.x.c);
    await flush();
    s.children[0]!.emit("Forwarding Webhook events from GitHub...");
    await flush();
    expect(s.src.status().state).toBe("connected");
    s.children[0]!.emit("Forwarding Webhook events from GitHub...");
    await flush();
    expect(s.x.reconnects).toHaveLength(2);
  });

  test("restarts a dead forwarder with backoff on the injected clock", async () => {
    const s = setup();
    await s.src.start(s.x.c);
    await flush();
    s.children[0]!.emit("error: unable to connect to webhooks server, forwarding stopped");
    s.children[0]!.exit(1);
    await flush();
    expect(s.src.status().state).toBe("disconnected");
    expect(s.src.status().detail).toContain("unable to connect");
    expect(s.children).toHaveLength(1);
    await s.clock.advance(999);
    expect(s.children).toHaveLength(1);
    await s.clock.advance(1);
    expect(s.children).toHaveLength(2);
    s.children[1]!.exit(1);
    await s.clock.advance(4999);
    expect(s.children).toHaveLength(2);
    await s.clock.advance(1);
    expect(s.children).toHaveLength(3);
    expect(s.clock.sleeps).toEqual([1000, 5000]);
  });

  test("a successful connect resets the backoff", async () => {
    const s = setup();
    await s.src.start(s.x.c);
    await flush();
    s.children[0]!.exit(1);
    await s.clock.advance(1000);
    s.children[1]!.emit("Forwarding Webhook events from GitHub...");
    s.children[1]!.exit(1);
    await s.clock.advance(1000);
    expect(s.children).toHaveLength(3);
    expect(s.clock.sleeps).toEqual([1000, 1000]);
  });

  test("stop kills children and does not restart them", async () => {
    const s = setup();
    await s.src.start(s.x.c);
    await flush();
    await s.src.stop();
    await s.src.settled();
    expect(s.children[0]!.killed).toBe(true);
    expect(s.children).toHaveLength(1);
    expect(s.src.status().state).toBe("stopped");
  });

  test("the real receiver verifies HMAC end to end over HTTP", async () => {
    const clock = new FakeClock();
    src = new GhWebhookForwardSource(
      { ...opts },
      { clock, port: 0, secret: SECRET, spawn: (cmd) => new FakeChild(cmd) },
    );
    const x = ctx([]);
    await src.start(x.c);
    const port = (src as any).server.port;
    const ok = await fetch(`http://127.0.0.1:${port}/github`, {
      method: "POST",
      headers: {
        "x-github-delivery": "h1",
        "x-github-event": "ping",
        "x-hub-signature-256": signature(SECRET, body),
      },
      body,
    });
    const bad = await fetch(`http://127.0.0.1:${port}/github`, {
      method: "POST",
      headers: {
        "x-github-delivery": "h2",
        "x-github-event": "ping",
        "x-hub-signature-256": "sha256=00",
      },
      body,
    });
    expect([ok.status, bad.status]).toEqual([202, 401]);
    expect(x.deliveries.map((d) => d.id)).toEqual(["h1"]);
  });
});
