import { errorMessage } from "../core/errors.ts";
import { parseLoggedTransition } from "../core/transition-codec.ts";
import type { Delivery, DeliveryFormat } from "./deliver.ts";
import { freshDelivery, type Deliver } from "./fresh.ts";
import { LogTailer } from "./tail.ts";

export interface RelayOptions {
  logPath: string;
  sessionId: string | null;
  cwd: string;
  format: DeliveryFormat;
  after: number;
  emit: (delivery: Delivery) => void;
  log: (message: string) => void;
  deliver?: Deliver;
}

export class ChannelRelay {
  private tailer: LogTailer | null = null;
  private pending: string[] = [];
  private draining: Promise<void> | null = null;
  private cursor: number;

  constructor(private readonly options: RelayOptions) {
    this.cursor = options.after;
  }

  start() {
    this.tailer = new LogTailer(this.options.logPath, (line) => this.enqueue(line));
    this.tailer.start();
  }

  stop() {
    this.tailer?.stop();
  }

  poll() {
    this.tailer?.poll();
  }

  async idle() {
    await this.draining;
  }

  private enqueue(line: string) {
    this.pending.push(line);
    this.draining ??= this.drain();
  }

  private async drain() {
    await Promise.resolve();
    while (this.pending.length > 0) {
      const lines = this.unseen(this.pending.splice(0));
      if (lines.length > 0) await this.forward(lines);
    }
    this.draining = null;
  }

  private unseen(lines: string[]) {
    return lines.filter((line) => {
      const id = parseLoggedTransition(line)?.id ?? null;
      if (id === null || id <= this.cursor) return false;
      this.cursor = id;
      return true;
    });
  }

  private async forward(lines: string[]) {
    const { sessionId, cwd, format, deliver = freshDelivery } = this.options;
    try {
      const deliveries = await deliver({ lines, sessionId, cwd, format });
      for (const delivery of deliveries) this.options.emit(delivery);
    } catch (error) {
      this.options.log(`skipping ${lines.length} transition(s): ${errorMessage(error)}`);
    }
  }
}
