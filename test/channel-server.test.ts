import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

async function* stdoutLines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
}

function spawnServer(configYaml: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "apl-chan-"));
  const home = join(dir, "home");
  const proj = join(dir, "proj");
  mkdirSync(home, { recursive: true });
  mkdirSync(proj, { recursive: true });
  if (configYaml) writeFileSync(join(proj, ".pr-autopilot.yaml"), configYaml);
  writeFileSync(join(home, "transitions.jsonl"), JSON.stringify({ id: 1, kind: "ready", repo: "acme/widgets", number: 1, head: "a", reason: "old", data: {}, title: "", url: "u", ts: "" }) + "\n");
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/channel/server.ts")], {
    cwd: proj,
    env: { ...process.env, PR_AUTOPILOT_HOME: home, MCP_PROTOCOL_NEGOTIATION: "legacy" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines = stdoutLines(proc.stdout);
  const send = (o: unknown) => {
    proc.stdin.write(JSON.stringify(o) + "\n");
    proc.stdin.flush();
  };
  const next = async () => JSON.parse((await lines.next()).value as string);
  const log = join(home, "transitions.jsonl");
  const errLines = stdoutLines(proc.stderr);
  const nextErr = async () => (await errLines.next()).value as string;
  return { proc, send, next, log, nextErr };
}

const transition = (id: number, repo: string, kind = "conflicted") =>
  JSON.stringify({ id, ts: "2026-10-06T00:00:00.000Z", kind, repo, number: 7, head: "1".repeat(40), reason: "conflicts with main", data: { base: "main" }, title: "Tidy", url: `https://github.com/${repo}/pull/7` }) + "\n";

test("speaks MCP over stdio and pushes new in-scope transitions as channel notifications", async () => {
  const s = spawnServer("repos:\n  - acme/widgets\n");
  try {
    s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    const init = await s.next();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities).toEqual({ experimental: { "claude/channel": {} } });
    expect(init.result.instructions).toContain("pr-autopilot:pr-autopilot skill");
    s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    s.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(await s.next()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    appendFileSync(s.log, transition(2, "acme/other"));
    appendFileSync(s.log, transition(3, "acme/widgets"));
    const n = await s.next();
    expect(n.method).toBe("notifications/claude/channel");
    expect(n.params.meta).toMatchObject({ kind: "conflicted", repo: "acme/widgets", pr: "7", transition_id: "3", base: "main" });
    expect(n.params.content).toBe("acme/widgets#7 conflicted: conflicts with main (Tidy) https://github.com/acme/widgets/pull/7");
  } finally {
    s.proc.kill();
  }
});

test("delivery.channel false keeps the server connected but silent", async () => {
  const s = spawnServer("repos:\n  - acme/widgets\ndelivery:\n  channel: false\n");
  try {
    s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    await s.next();
    s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(await s.nextErr()).toBe("[pr-autopilot channel] delivery.channel is false; staying silent");
    appendFileSync(s.log, transition(2, "acme/widgets"));
    s.send({ jsonrpc: "2.0", id: 9, method: "ping" });
    expect(await s.next()).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  } finally {
    s.proc.kill();
  }
});
