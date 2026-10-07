import { formatPullRequest } from "../../core/format.ts";
import { pullRequestKey } from "../../core/types.ts";
import { callDaemon, withOfflineStore } from "../daemon-api.ts";
import { CliError, print } from "../output.ts";
import { projectContext, resolveRef } from "../project.ts";
import type { Invocation } from "./types.ts";

const MODES = new Map<string | undefined, boolean | null>([
  ["on", true],
  ["off", false],
  ["default", null],
]);

export async function setAutoMerge({ argv, paths }: Invocation) {
  const { config } = await projectContext();
  const ref = await resolveRef(argv[0], config);
  const [, mode] = argv;
  const enabled = MODES.get(mode);
  if (enabled === undefined) {
    throw new CliError("usage: autopark auto-merge <pr> on|off|default");
  }
  const label = formatPullRequest(ref);
  if (!(await callDaemon(paths, "POST", "/auto-merge", { ...ref, enabled }))) {
    withOfflineStore(paths, (store) => {
      const key = pullRequestKey(ref.repo, ref.number);
      if (!store.getPullRequest(key)) throw new CliError(`${label} is not tracked`);
      store.setAutoMerge(key, enabled);
    });
  }
  print(`auto-merge ${mode} for ${label}`);
}
