import { existsSync } from "node:fs";
import { isPullRequestSummary } from "../core/guards.ts";
import { isArrayOf, stringAt, valueAt } from "../core/json.ts";
import { summarize, type PullRequestSummary } from "../core/summary.ts";
import { controlFetch, daemonHealth } from "../daemon/client.ts";
import type { Paths } from "../daemon/paths.ts";
import { Store } from "../daemon/store.ts";
import { CliError } from "./output.ts";

export interface StatusReport {
  daemon: string;
  pullRequests: PullRequestSummary[];
}

interface DaemonReply {
  error?: string;
  prs?: PullRequestSummary[];
}

function toDaemonReply(value: unknown): DaemonReply {
  const pullRequests = valueAt(value, "prs");
  return {
    error: stringAt(value, "error"),
    prs: isArrayOf(pullRequests, isPullRequestSummary) ? pullRequests : undefined,
  };
}

export async function callDaemon(paths: Paths, method: string, path: string, body?: unknown) {
  if (!(await daemonHealth(paths.socket))) return null;
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await controlFetch(paths.socket, path, { method, body: requestBody });
  const reply = toDaemonReply(await response.json());
  if (!response.ok) throw new CliError(reply.error ?? `daemon returned ${response.status}`);
  return reply;
}

export function withOfflineStore<Result>(paths: Paths, use: (store: Store) => Result): Result {
  const store = new Store(paths.db);
  try {
    return use(store);
  } finally {
    store.close();
  }
}

function lastKnownStatus(paths: Paths): StatusReport {
  if (!existsSync(paths.db)) {
    return { daemon: "daemon: not running (no state yet)", pullRequests: [] };
  }
  const store = new Store(paths.db, { readonly: true });
  try {
    const records = store.listPullRequests({ trackedOnly: true });
    const context = { now: Date.now(), holds: store.listHolds() };
    return {
      daemon: "daemon: not running (last known state)",
      pullRequests: records.map((record) => summarize(record, context)),
    };
  } finally {
    store.close();
  }
}

export async function loadStatus(paths: Paths): Promise<StatusReport> {
  const health = await daemonHealth(paths.socket);
  if (!health) return lastKnownStatus(paths);
  const reply = await callDaemon(paths, "GET", "/status");
  const source = `${health.source.name} ${health.source.state}`;
  return {
    daemon: `daemon: running (pid ${health.pid}, ${source})`,
    pullRequests: reply?.prs ?? [],
  };
}
