import { formatPullRequest } from "../../core/format.ts";
import { pullRequestKey } from "../../core/types.ts";
import { callDaemon, withOfflineStore } from "../daemon-api.ts";
import { print } from "../output.ts";
import { projectContext, resolveRef } from "../project.ts";
import type { Invocation } from "./types.ts";

export async function untrackPullRequest({ argv, paths }: Invocation) {
  const { config } = await projectContext();
  const ref = await resolveRef(argv[0], config);
  if (!(await callDaemon(paths, "POST", "/untrack", ref))) {
    withOfflineStore(paths, (store) =>
      store.setTracked(pullRequestKey(ref.repo, ref.number), false),
    );
  }
  print(`untracked ${formatPullRequest(ref)}`);
}
