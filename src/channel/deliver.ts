import type { Config } from "../config/schema.ts";
import { isRecord, isString, parseJson } from "../core/json.ts";
import { parseLoggedTransition } from "../core/transition-codec.ts";
import { resolvePaths, type Paths } from "../daemon/paths.ts";
import { cwdConfig } from "./context.ts";
import { liveDeliveries } from "./heartbeat.ts";
import { channelContent, channelMeta, monitorLine } from "./meta.ts";
import { deliveryScope, inScope, monitorShouldEmit } from "./scope.ts";

export type DeliveryFormat = "channel" | "monitor";

export interface DeliveryRequest {
  line: string;
  sessionId: string | null;
  cwd: string;
  format: DeliveryFormat;
}

export type Delivery =
  | { format: "channel"; content: string; meta: Record<string, string> }
  | { format: "monitor"; text: string };

const isChannelLive = (paths: Paths, sessionId: string | null) =>
  sessionId !== null &&
  liveDeliveries(paths, { sessionId }).some((heartbeat) => heartbeat.kind === "channel");

function isSilenced(request: DeliveryRequest, config: Config | null, paths: Paths) {
  const isChannelEnabled = config?.delivery.channel ?? true;
  if (request.format === "channel") return !isChannelEnabled;
  const mode = config?.delivery.monitor ?? "auto";
  const isLive = mode === "auto" && isChannelLive(paths, request.sessionId);
  return !monitorShouldEmit(mode, isChannelEnabled, isLive);
}

export async function deliveryFor(
  request: DeliveryRequest,
  paths: Paths = resolvePaths(),
): Promise<Delivery | null> {
  const transition = parseLoggedTransition(request.line);
  if (!transition) return null;
  const { config } = await cwdConfig(request.cwd);
  if (isSilenced(request, config, paths)) return null;
  const scope = deliveryScope(config?.repos ?? [], request.sessionId, paths.db);
  if (!inScope(transition, scope)) return null;
  if (request.format === "monitor") return { format: "monitor", text: monitorLine(transition) };
  const meta = channelMeta(transition);
  return { format: "channel", content: channelContent(transition), meta };
}

export function toDeliveryRequest(value: unknown): DeliveryRequest | null {
  if (!isRecord(value)) return null;
  const { line, sessionId, cwd, format } = value;
  if (!isString(line) || !isString(cwd)) return null;
  if (format !== "channel" && format !== "monitor") return null;
  return { line, cwd, format, sessionId: isString(sessionId) ? sessionId : null };
}

async function main() {
  const request = toDeliveryRequest(parseJson(await Bun.stdin.text()));
  const delivery = request ? await deliveryFor(request) : null;
  if (delivery) process.stdout.write(JSON.stringify(delivery));
}

if (import.meta.main) await main();
