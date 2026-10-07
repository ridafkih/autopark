import { LineSplitter } from "./line-splitter.ts";

class LineQueue {
  private readonly lines: string[] = [];
  private wake: (() => void) | null = null;

  constructor(private openStreams: number) {}

  push(lines: string[]) {
    this.lines.push(...lines);
    this.notify();
  }

  close() {
    this.openStreams = this.openStreams - 1;
    this.notify();
  }

  async *drain() {
    while (this.openStreams > 0 || this.lines.length > 0) {
      const line = this.lines.shift();
      if (line === undefined) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = null;
      } else {
        yield line;
      }
    }
  }

  private notify() {
    this.wake?.();
  }
}

async function pump(stream: ReadableStream<Uint8Array>, queue: LineQueue) {
  const splitter = new LineSplitter();
  for await (const chunk of stream) queue.push(splitter.feed(chunk));
  queue.push(splitter.flush());
  queue.close();
}

export function linesOf(...streams: Array<ReadableStream<Uint8Array>>) {
  const queue = new LineQueue(streams.length);
  for (const stream of streams) void pump(stream, queue);
  return queue.drain();
}
