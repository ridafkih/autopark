import { resolve } from "node:path";
import type { Delivery } from "../daemon/engine.ts";
import type { EventSource, SourceContext, SourceDeps, SourceState } from "./types.ts";

export async function readDeliveries(path: string): Promise<Delivery[]> {
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Delivery);
}

export class ReplaySource implements EventSource {
  readonly name = "replay";
  private ctx: SourceContext | null = null;
  private state: SourceState = "idle";
  private delivered = 0;

  constructor(private opts: { file?: string; deliveries?: Delivery[] } = {}) {}

  async start(ctx: SourceContext) {
    this.ctx = ctx;
    this.state = "connected";
    const fromFile = this.opts.file ? await readDeliveries(this.opts.file) : [];
    for (const d of [...(this.opts.deliveries ?? []), ...fromFile]) await this.push(d);
  }

  async push(d: Delivery) {
    if (!this.ctx) throw new Error("replay source not started");
    this.delivered++;
    await this.ctx.deliver(d);
  }

  reconnect(reason = "replay reconnect") {
    this.ctx?.reconnected(reason);
  }

  async stop() {
    this.state = "stopped";
    this.ctx = null;
  }

  status() {
    return { name: this.name, state: this.state, detail: `${this.delivered} deliveries replayed` };
  }
}

export const replayFactory = (options: Record<string, unknown>, deps: SourceDeps) =>
  new ReplaySource({
    file: typeof options.file === "string" ? resolve(deps.baseDir, options.file) : undefined,
  });
