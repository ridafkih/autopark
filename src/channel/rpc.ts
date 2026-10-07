const LATEST_PROTOCOL = "2025-06-18";
const METHOD_NOT_FOUND = -32_601;

export const SUPPORTED_PROTOCOLS = [LATEST_PROTOCOL, "2025-03-26", "2024-11-05"];

export interface ServerInfo {
  name: string;
  version: string;
  instructions: string;
}

export interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface RpcOutcome {
  response?: object;
  initialized?: boolean;
}

export function negotiate(requested: unknown) {
  const isSupported = typeof requested === "string" && SUPPORTED_PROTOCOLS.includes(requested);
  return isSupported ? requested : LATEST_PROTOCOL;
}

const reply = (id: RpcMessage["id"], result: object): RpcOutcome => ({
  response: { jsonrpc: "2.0", id, result },
});

const initializeResult = (message: RpcMessage, info: ServerInfo) => ({
  protocolVersion: negotiate(message.params?.protocolVersion),
  capabilities: { experimental: { "claude/channel": {} } },
  serverInfo: { name: info.name, version: info.version },
  instructions: info.instructions,
});

function methodNotFound(message: RpcMessage, isRequest: boolean): RpcOutcome {
  if (!isRequest) return {};
  const error = { code: METHOD_NOT_FOUND, message: `method not found: ${message.method}` };
  return { response: { jsonrpc: "2.0", id: message.id, error } };
}

export function handleRpc(message: RpcMessage | null, info: ServerInfo): RpcOutcome {
  const isRequest = message?.id !== undefined && message.id !== null;
  switch (message?.method) {
    case "initialize": {
      return reply(message.id, initializeResult(message, info));
    }
    case "notifications/initialized": {
      return { initialized: true };
    }
    case "ping": {
      return isRequest ? reply(message.id, {}) : {};
    }
    default: {
      return methodNotFound(message ?? {}, isRequest);
    }
  }
}
