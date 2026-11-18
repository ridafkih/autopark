import type { Config } from "../config/schema.ts";
import { isRecord, isString, parseJson } from "../core/json.ts";
import { parseLoggedTransition } from "../core/transition-codec.ts";
import type { LoggedTransition } from "../core/types.ts";
import { resolvePaths, type Paths } from "../daemon/paths.ts";
import { collapseBursts } from "./collapse.ts";
import { cwdConfig } from "./context.ts";
import { liveDeliveries } from "./heartbeat.ts";
import { channelContent, channelMeta, monitorLine } from "./meta.ts";
import { inScope, monitorShouldEmit } from "./scope.ts";
import { readCurrentState, recordOf } from "./state.ts";
import { stillHolds } from "./still-holds.ts";

export type DeliveryFormat = "channel" | "monitor";

export interface DeliveryRequest {
  lines: string[];
  sessionId: string | null;
  cwd: string;
  format: DeliveryFormat;
}

export type Delivery =
  | { format: "channel"; content: string; meta: Record<string, string> }
  | { format: "monitor"; text: string };

const DEFAULT_REVIEW_REQUEST_WHEN = "open";

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

const parseLines = (lines: string[]) =>
  lines.flatMap((line) => {
    const transition = parseLoggedTransition(line);
    return transition ? [transition] : [];
  });

function toDelivery(transition: LoggedTransition, format: DeliveryFormat): Delivery {
  if (format === "monitor") return { format, text: monitorLine(transition) };
  return { format, content: channelContent(transition), meta: channelMeta(transition) };
}

function liveTransitions(
  transitions: LoggedTransition[],
  request: DeliveryRequest,
  config: Config | null,
  paths: Paths,
) {
  const state = readCurrentState(paths.db, transitions, Date.now());
  const sessionOf = (transition: LoggedTransition) =>
    recordOf(state, transition)?.sessionId ?? null;
  const scope = { repos: config?.repos ?? [], sessionId: request.sessionId, sessionOf };
  const when = config?.reviewRequest.when ?? DEFAULT_REVIEW_REQUEST_WHEN;
  return transitions.filter(
    (transition) => inScope(transition, scope) && stillHolds(transition, state, when),
  );
}

export async function deliveriesFor(
  request: DeliveryRequest,
  paths: Paths = resolvePaths(),
): Promise<Delivery[]> {
  const transitions = parseLines(request.lines);
  if (transitions.length === 0) return [];
  const { config } = await cwdConfig(request.cwd);
  if (isSilenced(request, config, paths)) return [];
  const live = liveTransitions(transitions, request, config, paths);
  return collapseBursts(live).map((transition) => toDelivery(transition, request.format));
}

export function toDeliveryRequest(value: unknown): DeliveryRequest | null {
  if (!isRecord(value)) return null;
  const { lines, sessionId, cwd, format } = value;
  if (!Array.isArray(lines) || !lines.every(isString) || !isString(cwd)) return null;
  if (format !== "channel" && format !== "monitor") return null;
  return { lines, cwd, format, sessionId: isString(sessionId) ? sessionId : null };
}

async function main() {
  const request = toDeliveryRequest(parseJson(await Bun.stdin.text()));
  const deliveries = request ? await deliveriesFor(request) : [];
  process.stdout.write(JSON.stringify(deliveries));
}

if (import.meta.main) await main();
