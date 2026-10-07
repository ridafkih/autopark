export class LineSplitter {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  feed(chunk: Uint8Array) {
    const lines = `${this.buffer}${this.decoder.decode(chunk, { stream: true })}`.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines;
  }

  flush() {
    return this.buffer ? [this.buffer] : [];
  }
}
