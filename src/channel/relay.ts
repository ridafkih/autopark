import { errorMessage } from "../core/errors.ts";
import type { DeliveryFormat } from "./deliver.ts";
import { freshDelivery, type Deliver } from "./fresh.ts";
import { LogTailer } from "./tail.ts";

export interface RelayOptions {
  logPath: string;
  sessionId: string | null;
  cwd: string;
  format: DeliveryFormat;
  emit: (delivery: NonNullable<Awaited<ReturnType<Deliver>>>) => void;
  log: (message: string) => void;
  deliver?: Deliver;
}

export class ChannelRelay {
  private tailer: LogTailer | null = null;
  private pending: string[] = [];
  private draining: Promise<void> | null = null;

  constructor(private readonly options: RelayOptions) {}

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
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0);
      for (const line of batch) await this.forward(line);
    }
    this.draining = null;
  }

  private async forward(line: string) {
    const { sessionId, cwd, format, deliver = freshDelivery } = this.options;
    try {
      const delivery = await deliver({ line, sessionId, cwd, format });
      if (delivery) this.options.emit(delivery);
    } catch (error) {
      this.options.log(`skipping a transition: ${errorMessage(error)}`);
    }
  }
}
