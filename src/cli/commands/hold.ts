import { parseArgs } from "node:util";
import { formatDuration, parseDuration } from "../../core/duration.ts";
import { formatPullRequest } from "../../core/format.ts";
import { ALL_PULL_REQUESTS, checkHoldDuration, DEFAULT_HOLD_MS } from "../../core/hold.ts";
import { pullRequestKey } from "../../core/types.ts";
import type { Paths } from "../../daemon/paths.ts";
import { callDaemon, withOfflineStore } from "../daemon-api.ts";
import { CliError, print } from "../output.ts";
import { projectContext, resolveRef } from "../project.ts";
import type { Invocation } from "./types.ts";

const HOLD_OPTIONS = {
  for: { type: "string" },
  reason: { type: "string" },
} as const;

const OFFLINE = " (daemon not running; recorded for when it starts)";

interface Target {
  key: string;
  label: string;
  body: Record<string, unknown>;
}

async function resolveTarget(input: string | undefined): Promise<Target> {
  if (input === "all") {
    return { key: ALL_PULL_REQUESTS, label: "every tracked PR", body: { all: true } };
  }
  const { config } = await projectContext();
  const ref = await resolveRef(input, config);
  const body = { repo: ref.repo, number: ref.number };
  return { key: pullRequestKey(ref.repo, ref.number), label: formatPullRequest(ref), body };
}

function readDuration(text: string | undefined) {
  if (text === undefined) return DEFAULT_HOLD_MS;
  const parsed = parseDuration(text);
  if (parsed === null) throw new CliError(`not a duration: ${text} (try 30m or 1h30m)`);
  try {
    return checkHoldDuration(parsed);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

function holdOffline(paths: Paths, target: Target, durationMs: number, reason: string | null) {
  withOfflineStore(paths, (store) => {
    if (target.key !== ALL_PULL_REQUESTS && !store.getPullRequest(target.key)?.tracked) {
      throw new CliError(`${target.label} is not tracked`);
    }
    const now = Date.now();
    store.setHold({ target: target.key, until: now + durationMs, reason, createdAt: now });
  });
}

export async function holdPullRequests({ argv, paths }: Invocation) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: HOLD_OPTIONS,
  });
  const target = await resolveTarget(positionals[0]);
  const durationMs = readDuration(values.for);
  const reason = values.reason ?? null;
  const body = { ...target.body, durationMs, reason };
  const isOnline = (await callDaemon(paths, "POST", "/hold", body)) !== null;
  if (!isOnline) holdOffline(paths, target, durationMs, reason);
  const why = reason ? `: ${reason}` : "";
  const suffix = isOnline ? "" : OFFLINE;
  print(`holding ${target.label} for ${formatDuration(durationMs)}${why}${suffix}`);
}

export async function unholdPullRequests({ argv, paths }: Invocation) {
  const target = await resolveTarget(argv[0]);
  if (!(await callDaemon(paths, "POST", "/unhold", target.body))) {
    withOfflineStore(paths, (store) => {
      if (target.key === ALL_PULL_REQUESTS) store.clearAllHolds();
      else store.clearHold(target.key);
    });
  }
  const released =
    target.key === ALL_PULL_REQUESTS
      ? "released every hold"
      : `released the hold on ${target.label}`;
  print(released);
}
