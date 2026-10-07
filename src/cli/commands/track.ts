import { parseArgs } from "node:util";
import { formatPullRequest } from "../../core/format.ts";
import { pullRequestKey } from "../../core/types.ts";
import { callDaemon, withOfflineStore } from "../daemon-api.ts";
import { print } from "../output.ts";
import { projectContext, resolveRef } from "../project.ts";
import type { Invocation } from "./types.ts";

const TRACK_OPTIONS = {
  session: { type: "string" },
  "auto-merge": { type: "boolean" },
} as const;

export async function trackPullRequest({ argv, paths }: Invocation) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: TRACK_OPTIONS,
  });
  const { config } = await projectContext();
  const ref = await resolveRef(positionals[0], config);
  const sessionId = values.session ?? process.env.CLAUDE_SESSION_ID ?? null;
  const autoMerge = values["auto-merge"] ? true : undefined;
  const label = formatPullRequest(ref);
  if (await callDaemon(paths, "POST", "/track", { ...ref, sessionId, autoMerge })) {
    print(`tracking ${label}`);
    return;
  }
  withOfflineStore(paths, (store) => {
    store.track({ ...ref, source: "explicit", sessionId, now: Date.now() });
    if (autoMerge) store.setAutoMerge(pullRequestKey(ref.repo, ref.number), true);
  });
  print(`tracking ${label} (daemon not running; it will evaluate on start)`);
}
