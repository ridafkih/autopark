import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/daemon/store.ts";
import { LineSplitter } from "../src/sources/line-splitter.ts";

const ROOT = resolve(import.meta.dir, "..");

const jsonLine = (value: unknown) => `${JSON.stringify(value)}\n`;

const OLD_TRANSITION = jsonLine({
  id: 1,
  kind: "ready",
  repo: "acme/widgets",
  number: 1,
  head: "a",
  reason: "old",
  data: {},
  title: "",
  url: "u",
  ts: "",
});

async function* streamLines(stream: ReadableStream<Uint8Array>) {
  const splitter = new LineSplitter();
  for await (const chunk of stream) yield* splitter.feed(chunk);
}

async function nextValue(lines: AsyncGenerator<string>) {
  const { value } = await lines.next();
  if (typeof value !== "string") throw new Error("stream ended before the next line");
  return value;
}

function prepareProject(configYaml: string | null) {
  const directory = mkdtempSync(join(tmpdir(), "apl-chan-"));
  const home = join(directory, "home");
  const project = join(directory, "proj");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  if (configYaml !== null) writeFileSync(join(project, ".autopark.yaml"), configYaml);
  writeFileSync(join(home, "transitions.jsonl"), OLD_TRANSITION);
  return { home, project };
}

interface ServerSetup {
  configYaml: string | null;
  sessionId?: string;
  bindings?: Array<{ number: number; sessionId: string | null }>;
}

function bindPullRequests(home: string, bindings: ServerSetup["bindings"] = []) {
  const store = new Store(join(home, "state.db"));
  try {
    for (const { number, sessionId } of bindings) {
      store.track({ repo: "acme/widgets", number, source: "explicit", sessionId, now: 1 });
    }
  } finally {
    store.close();
  }
}

function spawnServer({ configYaml, sessionId = "", bindings }: ServerSetup) {
  const { home, project } = prepareProject(configYaml);
  bindPullRequests(home, bindings);
  const subprocess = Bun.spawn([process.execPath, join(ROOT, "src/channel/server.ts")], {
    cwd: project,
    env: {
      ...process.env,
      AUTOPARK_HOME: home,
      MCP_PROTOCOL_NEGOTIATION: "legacy",
      CLAUDE_CODE_SESSION_ID: sessionId,
      CLAUDE_SESSION_ID: "",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const outputLines = streamLines(subprocess.stdout);
  const errorLines = streamLines(subprocess.stderr);
  const send = (message: unknown) => {
    subprocess.stdin.write(jsonLine(message));
    subprocess.stdin.flush();
  };
  const nextMessage = async () => JSON.parse(await nextValue(outputLines));
  const nextErrorLine = () => nextValue(errorLines);
  const log = join(home, "transitions.jsonl");
  return { subprocess, send, nextMessage, log, nextErrorLine };
}

type ChannelServer = ReturnType<typeof spawnServer>;

async function withServer(
  setup: string | ServerSetup,
  run: (server: ChannelServer) => Promise<void>,
) {
  const server = spawnServer(typeof setup === "string" ? { configYaml: setup } : setup);
  try {
    await run(server);
  } finally {
    server.subprocess.kill();
  }
}

const transition = (id: number, repo: string, kind = "conflicted", number = 7) =>
  jsonLine({
    id,
    ts: "2026-10-06T00:00:00.000Z",
    kind,
    repo,
    number,
    head: "1".repeat(40),
    reason: "conflicts with main",
    data: { base: "main" },
    title: "Tidy",
    url: `https://github.com/${repo}/pull/${number}`,
  });

async function initialize(server: ChannelServer) {
  server.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  await server.nextMessage();
  server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

test("speaks MCP over stdio and pushes new in-scope transitions as channel notifications", async () => {
  await withServer("repos:\n  - acme/widgets\n", async (server) => {
    server.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    const initialization = await server.nextMessage();
    expect(initialization.result.protocolVersion).toBe("2025-06-18");
    expect(initialization.result.capabilities).toEqual({ experimental: { "claude/channel": {} } });
    expect(initialization.result.instructions).toContain("autopark:autopark skill");
    server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    server.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(await server.nextMessage()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    appendFileSync(server.log, transition(2, "acme/other"));
    appendFileSync(server.log, transition(3, "acme/widgets"));
    const notification = await server.nextMessage();
    expect(notification.method).toBe("notifications/claude/channel");
    expect(notification.params.meta).toMatchObject({
      kind: "conflicted",
      repo: "acme/widgets",
      pr: "7",
      transition_id: "3",
      base: "main",
    });
    expect(notification.params.content).toBe(
      "acme/widgets#7 conflicted: conflicts with main (Tidy) https://github.com/acme/widgets/pull/7",
    );
  });
});

test("delivery.channel false keeps the server connected but silent", async () => {
  await withServer("repos:\n  - acme/widgets\ndelivery:\n  channel: false\n", async (server) => {
    server.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    await server.nextMessage();
    server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(await server.nextErrorLine()).toBe(
      "[autopark channel] delivery.channel is false; staying silent",
    );
    appendFileSync(server.log, transition(2, "acme/widgets"));
    server.send({ jsonrpc: "2.0", id: 9, method: "ping" });
    expect(await server.nextMessage()).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  });
});

test("outside any config, only PRs bound to this session are pushed", async () => {
  const bindings = [
    { number: 7, sessionId: "s1" },
    { number: 8, sessionId: "s2" },
    { number: 9, sessionId: null },
  ];
  await withServer({ configYaml: null, sessionId: "s1", bindings }, async (server) => {
    await initialize(server);
    server.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    await server.nextMessage();
    appendFileSync(server.log, transition(2, "acme/widgets", "conflicted", 8));
    appendFileSync(server.log, transition(3, "acme/widgets", "conflicted", 9));
    appendFileSync(server.log, transition(4, "acme/widgets", "conflicted", 10));
    appendFileSync(server.log, transition(5, "acme/widgets", "conflicted", 7));
    const notification = await server.nextMessage();
    expect(notification.params.meta).toMatchObject({ pr: "7", transition_id: "5" });
  });
});

test("outside any config and without a session, nothing is pushed", async () => {
  const bindings = [{ number: 7, sessionId: "s1" }];
  await withServer({ configYaml: null, bindings }, async (server) => {
    await initialize(server);
    server.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    await server.nextMessage();
    appendFileSync(server.log, transition(2, "acme/widgets", "conflicted", 7));
    await Bun.sleep(300);
    server.send({ jsonrpc: "2.0", id: 9, method: "ping" });
    expect(await server.nextMessage()).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  });
});
