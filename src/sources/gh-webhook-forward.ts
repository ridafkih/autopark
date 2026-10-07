import type { Clock } from "../daemon/clock.ts";
import { startReceiver } from "./receiver.ts";
import type { ChildHandle, EventSource, SourceContext, SourceDeps, SourceState, Spawner } from "./types.ts";

export const DEFAULT_EVENTS = [
  "push",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
  "issue_comment",
  "check_run",
  "check_suite",
  "status",
];

const CONNECTED = /forwarding webhook events/i;

export interface GhForwardOptions {
  gh: string;
  events: string[];
  hostname: string;
  path: string;
  restartBackoffMs: number[];
}

export function forwardArgs(o: GhForwardOptions, repo: string, port: number, secret: string) {
  return [o.gh, "webhook", "forward", `--repo=${repo}`, `--events=${o.events.join(",")}`, `--url=http://${o.hostname}:${port}${o.path}`, `--secret=${secret}`];
}

export class GhWebhookForwardSource implements EventSource {
  readonly name = "gh-webhook-forward";
  private running = false;
  private children = new Map<string, ChildHandle>();
  private states = new Map<string, SourceState>();
  private server: ReturnType<typeof startReceiver> | null = null;
  private loops: Promise<void>[] = [];
  private lastError = "";

  constructor(
    private o: GhForwardOptions,
    private deps: { clock: Clock; port: number; secret: string; spawn: Spawner; listen?: boolean },
  ) {}

  async start(ctx: SourceContext) {
    this.running = true;
    let port = this.deps.port;
    if (this.deps.listen !== false) {
      this.server = startReceiver({ hostname: this.o.hostname, port, path: this.o.path, secret: this.deps.secret, deliver: (d) => ctx.deliver(d) });
      port = this.server.port ?? port;
    }
    for (const repo of ctx.repos) this.loops.push(this.supervise(repo, port, ctx));
  }

  private async supervise(repo: string, port: number, ctx: SourceContext) {
    let failures = 0;
    while (this.running) {
      this.states.set(repo, "connecting");
      const child = this.deps.spawn(forwardArgs(this.o, repo, port, this.deps.secret), {});
      this.children.set(repo, child);
      const reader = (async () => {
        for await (const line of child.lines) {
          if (CONNECTED.test(line)) {
            failures = 0;
            this.states.set(repo, "connected");
            ctx.reconnected(`gh webhook forward connected for ${repo}`);
          } else if (/error|unable|denied|not have access/i.test(line)) {
            this.lastError = `${repo}: ${line.trim()}`;
            ctx.log(`gh webhook forward ${repo}: ${line.trim()}`);
          }
        }
      })();
      const code = await child.exited;
      await reader.catch(() => {});
      this.children.delete(repo);
      if (!this.running) break;
      this.states.set(repo, "disconnected");
      const delay = this.o.restartBackoffMs[Math.min(failures, this.o.restartBackoffMs.length - 1)] ?? 5000;
      failures++;
      ctx.log(`gh webhook forward for ${repo} exited ${code}; restarting in ${delay}ms`);
      await this.deps.clock.sleep(delay);
    }
    this.states.set(repo, "stopped");
  }

  async stop() {
    this.running = false;
    for (const c of this.children.values()) c.kill();
    this.server?.stop(true);
    this.server = null;
  }

  async settled() {
    await Promise.all(this.loops);
  }

  status() {
    const perRepo = Object.fromEntries(this.states);
    const values = [...this.states.values()];
    const state: SourceState = !this.running
      ? "stopped"
      : values.length && values.every((s) => s === "connected")
        ? "connected"
        : values.some((s) => s === "disconnected")
          ? "disconnected"
          : "connecting";
    return { name: this.name, state, detail: this.lastError, perRepo };
  }
}

async function* linesOf(...streams: ReadableStream<Uint8Array>[]) {
  const queue: string[] = [];
  const waiter: { notify: (() => void) | null } = { notify: null };
  let open = streams.length;
  for (const s of streams) {
    (async () => {
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of s) {
        buf += decoder.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          queue.push(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
        waiter.notify?.();
      }
      if (buf) queue.push(buf);
      open--;
      waiter.notify?.();
    })();
  }
  while (open > 0 || queue.length) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    await new Promise<void>((r) => (waiter.notify = r));
    waiter.notify = null;
  }
}

export const bunSpawner: Spawner = (cmd, env) => {
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { lines: linesOf(proc.stdout, proc.stderr), exited: proc.exited, kill: () => proc.kill() };
};

export const ghForwardFactory = (options: Record<string, unknown>, deps: SourceDeps) =>
  new GhWebhookForwardSource(
    {
      gh: typeof options.gh === "string" ? options.gh : "gh",
      events: Array.isArray(options.events) ? (options.events as string[]) : DEFAULT_EVENTS,
      hostname: typeof options.hostname === "string" ? options.hostname : "127.0.0.1",
      path: typeof options.path === "string" ? options.path : "/github",
      restartBackoffMs: Array.isArray(options.restartBackoffMs) ? (options.restartBackoffMs as number[]) : [1000, 2000, 5000, 10000, 30000, 60000],
    },
    deps,
  );
