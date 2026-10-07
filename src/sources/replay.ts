import { resolve } from "node:path";
import { parseJson, stringAt, valueAt } from "../core/json.ts";
import type {
  Delivery,
  EventSource,
  SourceContext,
  SourceDependencies,
  SourceState,
} from "./types.ts";

interface ReplayOptions {
  file?: string;
  deliveries?: Delivery[];
}

function toDelivery(value: unknown): Delivery {
  const id = stringAt(value, "id");
  const event = stringAt(value, "event");
  if (id === undefined || event === undefined) throw new Error("replay line is not a delivery");
  return { id, event, payload: valueAt(value, "payload") };
}

export async function readDeliveries(path: string): Promise<Delivery[]> {
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => toDelivery(parseJson(line)));
}

export class ReplaySource implements EventSource {
  readonly name = "replay";
  private context: SourceContext | null = null;
  private state: SourceState = "idle";
  private delivered = 0;

  constructor(private readonly options: ReplayOptions = {}) {}

  async start(context: SourceContext) {
    this.context = context;
    this.state = "connected";
    const fromFile = this.options.file ? await readDeliveries(this.options.file) : [];
    const deliveries = [...(this.options.deliveries ?? []), ...fromFile];
    for (const delivery of deliveries) await this.push(delivery);
  }

  async push(delivery: Delivery) {
    if (!this.context) throw new Error("replay source not started");
    this.delivered = this.delivered + 1;
    await this.context.deliver(delivery);
  }

  reconnect(reason = "replay reconnect") {
    this.context?.reconnected(reason);
  }

  async stop() {
    this.state = "stopped";
    this.context = null;
  }

  status() {
    return { name: this.name, state: this.state, detail: `${this.delivered} deliveries replayed` };
  }
}

export const replayFactory = (options: Record<string, unknown>, dependencies: SourceDependencies) =>
  new ReplaySource({
    file:
      typeof options.file === "string" ? resolve(dependencies.baseDir, options.file) : undefined,
  });
