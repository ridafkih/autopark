export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export function negotiate(requested: unknown) {
  return typeof requested === "string" && SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0]!;
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions: string;
}

export function handleRpc(msg: any, info: ServerInfo): { response?: object; initialized?: boolean } {
  const isRequest = msg && msg.id !== undefined && msg.id !== null;
  switch (msg?.method) {
    case "initialize":
      return {
        response: {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: negotiate(msg.params?.protocolVersion),
            capabilities: { experimental: { "claude/channel": {} } },
            serverInfo: { name: info.name, version: info.version },
            instructions: info.instructions,
          },
        },
      };
    case "notifications/initialized":
      return { initialized: true };
    case "ping":
      return isRequest ? { response: { jsonrpc: "2.0", id: msg.id, result: {} } } : {};
  }
  if (!isRequest) return {};
  return { response: { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg?.method}` } } };
}

export class StdioMcp {
  private buf = "";
  ready = false;

  constructor(
    private info: ServerInfo,
    private write: (s: string) => void,
    private onReady: () => void,
  ) {}

  feed(chunk: string) {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        this.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        continue;
      }
      const r = handleRpc(msg, this.info);
      if (r.response) this.send(r.response);
      if (r.initialized && !this.ready) {
        this.ready = true;
        this.onReady();
      }
    }
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(obj: unknown) {
    this.write(`${JSON.stringify(obj)}\n`);
  }
}
