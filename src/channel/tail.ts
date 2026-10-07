import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { basename, dirname } from "node:path";

export class LogTailer {
  private offset = 0;
  private partial = "";
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private path: string,
    private onLine: (line: string) => void,
    private opts: { watch?: boolean; safetyMs?: number } = {},
  ) {}

  private size() {
    return existsSync(this.path) ? statSync(this.path).size : 0;
  }

  start() {
    this.offset = this.size();
    if (this.opts.watch === false) return;
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const name = basename(this.path);
    this.watcher = watch(dir, (_event, file) => {
      if (!file || file === name) this.poll();
    });
    this.timer = setInterval(() => this.poll(), this.opts.safetyMs ?? 5000);
  }

  poll() {
    const size = this.size();
    if (size < this.offset) {
      this.offset = 0;
      this.partial = "";
    }
    if (size === this.offset) return;
    const fd = openSync(this.path, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      const n = readSync(fd, buf, 0, buf.length, this.offset);
      this.offset += n;
      this.partial += buf.subarray(0, n).toString("utf8");
    } finally {
      closeSync(fd);
    }
    let i: number;
    while ((i = this.partial.indexOf("\n")) >= 0) {
      const line = this.partial.slice(0, i).trim();
      this.partial = this.partial.slice(i + 1);
      if (line) this.onLine(line);
    }
  }

  stop() {
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
  }
}
