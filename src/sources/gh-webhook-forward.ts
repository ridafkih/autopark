import type { Clock } from "../daemon/clock.ts";
import { forwardArgs, readForwardOptions, type GhForwardOptions } from "./gh-forward-options.ts";
import { startReceiver } from "./receiver.ts";
import type {
  ChildHandle,
  EventSource,
  SourceContext,
  SourceDependencies,
  SourceState,
  Spawner,
} from "./types.ts";

export { DEFAULT_EVENTS, forwardArgs, type GhForwardOptions } from "./gh-forward-options.ts";

interface ForwardDependencies {
  clock: Clock;
  port: number;
  secret: string;
  spawn: Spawner;
  listen?: boolean;
}

const CONNECTED = /forwarding webhook events/iu;
const FAILURE = /error|unable|denied|not have access/iu;
const FALLBACK_RESTART_MS = 5000;

function overallState(isRunning: boolean, states: SourceState[]): SourceState {
  if (!isRunning) return "stopped";
  if (states.length > 0 && states.every((state) => state === "connected")) return "connected";
  return states.includes("disconnected") ? "disconnected" : "connecting";
}

export class GhWebhookForwardSource implements EventSource {
  readonly name = "gh-webhook-forward";
  private isRunning = false;
  private readonly children = new Map<string, ChildHandle>();
  private readonly states = new Map<string, SourceState>();
  private readonly failures = new Map<string, number>();
  private server: ReturnType<typeof startReceiver> | null = null;
  private loops: Array<Promise<void>> = [];
  private lastError = "";

  constructor(
    private readonly options: GhForwardOptions,
    private readonly dependencies: ForwardDependencies,
  ) {}

  async start(context: SourceContext) {
    this.isRunning = true;
    if (this.dependencies.listen !== false) {
      this.server = startReceiver({
        hostname: this.options.hostname,
        port: this.dependencies.port,
        path: this.options.path,
        secret: this.dependencies.secret,
        deliver: (delivery) => context.deliver(delivery),
      });
    }
    const port = this.server?.port ?? this.dependencies.port;
    this.loops = context.repos.map((repo) => this.supervise(repo, port, context));
  }

  async stop() {
    this.isRunning = false;
    for (const child of this.children.values()) child.kill();
    void this.server?.stop(true);
    this.server = null;
  }

  listeningPort() {
    return this.server?.port ?? null;
  }

  async settled() {
    await Promise.all(this.loops);
  }

  status() {
    const state = overallState(this.isRunning, [...this.states.values()]);
    return {
      name: this.name,
      state,
      detail: this.lastError,
      perRepo: Object.fromEntries(this.states),
    };
  }

  private async supervise(repo: string, port: number, context: SourceContext) {
    while (this.isRunning) {
      const code = await this.runForwarder(repo, port, context);
      if (!this.isRunning) break;
      this.states.set(repo, "disconnected");
      const delayMs = this.nextRestartDelay(repo);
      context.log(`gh webhook forward for ${repo} exited ${code}; restarting in ${delayMs}ms`);
      await this.dependencies.clock.sleep(delayMs);
    }
    this.states.set(repo, "stopped");
  }

  private async runForwarder(repo: string, port: number, context: SourceContext) {
    this.states.set(repo, "connecting");
    const args = forwardArgs(this.options, repo, port, this.dependencies.secret);
    const child = this.dependencies.spawn(args, {});
    this.children.set(repo, child);
    const reader = this.watchOutput(repo, child, context);
    const code = await child.exited;
    await Promise.allSettled([reader]);
    this.children.delete(repo);
    return code;
  }

  private async watchOutput(repo: string, child: ChildHandle, context: SourceContext) {
    for await (const line of child.lines) {
      if (CONNECTED.test(line)) {
        this.failures.set(repo, 0);
        this.states.set(repo, "connected");
        context.reconnected(`gh webhook forward connected for ${repo}`);
      } else if (FAILURE.test(line)) {
        this.lastError = `${repo}: ${line.trim()}`;
        context.log(`gh webhook forward ${repo}: ${line.trim()}`);
      }
    }
  }

  private nextRestartDelay(repo: string) {
    const failures = this.failures.get(repo) ?? 0;
    const backoff = this.options.restartBackoffMs;
    this.failures.set(repo, failures + 1);
    return backoff[Math.min(failures, backoff.length - 1)] ?? FALLBACK_RESTART_MS;
  }
}

export const ghForwardFactory = (
  options: Record<string, unknown>,
  dependencies: SourceDependencies,
) => new GhWebhookForwardSource(readForwardOptions(options), dependencies);
