import { existsSync } from "node:fs";
import type { Health } from "./control.ts";

export const VERSION = "0.1.0";

const CONTROL_TIMEOUT_MS = 2000;

export function controlFetch(socket: string, path: string, init: RequestInit = {}) {
  return fetch(`http://localhost${path}`, {
    ...init,
    unix: socket,
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  });
}

export async function daemonHealth(socket: string): Promise<Health | null> {
  if (!existsSync(socket)) return null;
  try {
    const response = await controlFetch(socket, "/health");
    return response.ok ? ((await response.json()) as Health) : null;
  } catch {
    return null;
  }
}
