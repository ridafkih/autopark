import { handleRpc, type RpcMessage, type ServerInfo } from "./rpc.ts";

export { handleRpc, negotiate, SUPPORTED_PROTOCOLS, type ServerInfo } from "./rpc.ts";

const PARSE_ERROR = -32_700;

type ParsedLine = { ok: true; message: RpcMessage | null } | { ok: false };

function parseLine(line: string): ParsedLine {
  try {
    return { ok: true, message: JSON.parse(line) as RpcMessage | null };
  } catch {
    return { ok: false };
  }
}

export class StdioMcp {
  isReady = false;
  private buffer = "";

  constructor(
    private readonly info: ServerInfo,
    private readonly write: (text: string) => void,
    private readonly onReady: () => void,
  ) {}

  feed(chunk: string) {
    const lines = `${this.buffer}${chunk}`.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.handleLine(line.trim());
  }

  notify(method: string, parameters: unknown) {
    this.send({ jsonrpc: "2.0", method, params: parameters });
  }

  private handleLine(line: string) {
    if (!line) return;
    const parsed = parseLine(line);
    if (!parsed.ok) {
      this.send({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "parse error" } });
      return;
    }
    const outcome = handleRpc(parsed.message, this.info);
    if (outcome.response) this.send(outcome.response);
    if (outcome.initialized && !this.isReady) {
      this.isReady = true;
      this.onReady();
    }
  }

  private send(message: unknown) {
    this.write(`${JSON.stringify(message)}\n`);
  }
}
