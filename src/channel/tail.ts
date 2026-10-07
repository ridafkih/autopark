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

interface TailOptions {
  watch?: boolean;
  safetyMs?: number;
}

const DEFAULT_SAFETY_MS = 5000;

function readFrom(path: string, offset: number, size: number) {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size - offset);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, offset);
    return { bytesRead, text: buffer.subarray(0, bytesRead).toString("utf8") };
  } finally {
    closeSync(descriptor);
  }
}

export class LogTailer {
  private offset = 0;
  private partial = "";
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly path: string,
    private readonly onLine: (line: string) => void,
    private readonly options: TailOptions = {},
  ) {}

  start() {
    this.offset = this.size();
    if (this.options.watch === false) return;
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true });
    const name = basename(this.path);
    this.watcher = watch(directory, (_event, file) => {
      if (!file || file === name) this.poll();
    });
    this.timer = setInterval(() => this.poll(), this.options.safetyMs ?? DEFAULT_SAFETY_MS);
  }

  poll() {
    const size = this.size();
    if (size < this.offset) {
      this.offset = 0;
      this.partial = "";
    }
    if (size === this.offset) return;
    const { bytesRead, text } = readFrom(this.path, this.offset, size);
    this.offset = this.offset + bytesRead;
    const lines = `${this.partial}${text}`.split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines.map((entry) => entry.trim())) if (line) this.onLine(line);
  }

  stop() {
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
  }

  private size() {
    return existsSync(this.path) ? statSync(this.path).size : 0;
  }
}
