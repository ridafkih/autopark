import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  return value as string;
}

function prepareProject(configYaml: string) {
  const directory = mkdtempSync(join(tmpdir(), "apl-chan-"));
  const home = join(directory, "home");
  const project = join(directory, "proj");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, ".pr-autopilot.yaml"), configYaml);
  writeFileSync(join(home, "transitions.jsonl"), OLD_TRANSITION);
  return { home, project };
}

function spawnServer(configYaml: string) {
  const { home, project } = prepareProject(configYaml);
  const subprocess = Bun.spawn([process.execPath, join(ROOT, "src/channel/server.ts")], {
    cwd: project,
    env: { ...process.env, PR_AUTOPILOT_HOME: home, MCP_PROTOCOL_NEGOTIATION: "legacy" },
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

async function withServer(configYaml: string, run: (server: ChannelServer) => Promise<void>) {
  const server = spawnServer(configYaml);
  try {
    await run(server);
  } finally {
    server.subprocess.kill();
  }
}

const transition = (id: number, repo: string, kind = "conflicted") =>
  jsonLine({
    id,
    ts: "2026-10-06T00:00:00.000Z",
    kind,
    repo,
    number: 7,
    head: "1".repeat(40),
    reason: "conflicts with main",
    data: { base: "main" },
    title: "Tidy",
    url: `https://github.com/${repo}/pull/7`,
  });

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
    expect(initialization.result.instructions).toContain("pr-autopilot:pr-autopilot skill");
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
      "[pr-autopilot channel] delivery.channel is false; staying silent",
    );
    appendFileSync(server.log, transition(2, "acme/widgets"));
    server.send({ jsonrpc: "2.0", id: 9, method: "ping" });
    expect(await server.nextMessage()).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  });
});
