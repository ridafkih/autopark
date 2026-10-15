import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { isNumber, isRecord, isString, parseJson } from "../core/json.ts";
import type { Paths } from "../daemon/paths.ts";

export type DeliveryKind = "channel" | "monitor";

export interface Heartbeat {
  kind: DeliveryKind;
  pid: number;
  sessionId: string;
  stamp: string;
  startedAt: number;
}

const ROOT = resolve(import.meta.dir, "../..");

export const DELIVERY_SOURCES = [
  "src/channel/heartbeat.ts",
  "src/channel/meta.ts",
  "src/channel/relay.ts",
  "src/channel/scope.ts",
  "src/channel/server.ts",
  "src/channel/tail.ts",
  "src/cli/commands/watch.ts",
  "src/core/transition-codec.ts",
];

export function codeStamp(root = ROOT, sources = DELIVERY_SOURCES) {
  const hash = createHash("sha256");
  for (const source of sources) {
    const path = join(root, source);
    hash.update(source);
    hash.update(existsSync(path) ? readFileSync(path) : "missing");
  }
  return hash.digest("hex").slice(0, 16);
}

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === "EPERM";
  }
};

const fileOf = (paths: Paths, kind: DeliveryKind, pid: number) =>
  join(paths.deliveries, `${kind}-${pid}.json`);

export function writeHeartbeat(paths: Paths, heartbeat: Heartbeat) {
  mkdirSync(paths.deliveries, { recursive: true });
  writeFileSync(fileOf(paths, heartbeat.kind, heartbeat.pid), JSON.stringify(heartbeat));
}

export function removeHeartbeat(paths: Paths, kind: DeliveryKind, pid: number) {
  rmSync(fileOf(paths, kind, pid), { force: true });
}

function toHeartbeat(value: unknown): Heartbeat | null {
  if (!isRecord(value)) return null;
  const { kind, pid, sessionId, stamp, startedAt } = value;
  if (kind !== "channel" && kind !== "monitor") return null;
  if (!isNumber(pid) || !isString(sessionId) || !isString(stamp) || !isNumber(startedAt)) {
    return null;
  }
  return { kind, pid, sessionId, stamp, startedAt };
}

function readHeartbeat(path: string): Heartbeat | null {
  try {
    return statSync(path).isFile() ? toHeartbeat(parseJson(readFileSync(path, "utf8"))) : null;
  } catch {
    return null;
  }
}

export interface LiveQuery {
  sessionId: string;
  stamp: string;
  isProcessAlive?: (pid: number) => boolean;
}

export function liveDeliveries(
  paths: Paths,
  { sessionId, stamp, isProcessAlive = isAlive }: LiveQuery,
) {
  if (!existsSync(paths.deliveries)) return [];
  return readdirSync(paths.deliveries)
    .flatMap((name) => {
      const heartbeat = readHeartbeat(join(paths.deliveries, name));
      return heartbeat ? [heartbeat] : [];
    })
    .filter(
      (heartbeat) =>
        heartbeat.sessionId === sessionId &&
        heartbeat.stamp === stamp &&
        isProcessAlive(heartbeat.pid),
    );
}
