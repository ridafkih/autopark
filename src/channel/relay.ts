import { errorMessage } from "../core/errors.ts";
import type { LoggedTransition } from "../core/types.ts";
import type { StdioMcp } from "./mcp.ts";
import { channelContent, channelMeta } from "./meta.ts";
import { inScope, type DeliveryScope } from "./scope.ts";
import { LogTailer } from "./tail.ts";

export interface RelayOptions {
  logPath: string;
  scope: DeliveryScope;
  isEnabled: boolean;
  log: (message: string) => void;
}

export class ChannelRelay {
  private tailer: LogTailer | null = null;

  constructor(
    private readonly mcp: StdioMcp,
    private readonly options: RelayOptions,
  ) {}

  start() {
    if (!this.options.isEnabled) {
      this.options.log("delivery.channel is false; staying silent");
      return;
    }
    this.tailer = new LogTailer(this.options.logPath, (line) => this.forward(line));
    this.tailer.start();
  }

  stop() {
    this.tailer?.stop();
  }

  private forward(line: string) {
    try {
      const transition = JSON.parse(line) as LoggedTransition;
      if (!inScope(transition, this.options.scope)) return;
      this.mcp.notify("notifications/claude/channel", {
        content: channelContent(transition),
        meta: channelMeta(transition),
      });
    } catch (error) {
      this.options.log(`skipping bad line: ${errorMessage(error)}`);
    }
  }
}
