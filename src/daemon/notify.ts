import type { Config } from "../config/schema.ts";
import type { LoggedTransition } from "../core/types.ts";
import type { CommandRunner } from "./runner.ts";

export function transitionEnv(t: LoggedTransition): Record<string, string> {
  return {
    PR_AUTOPILOT_KIND: t.kind,
    PR_AUTOPILOT_REPO: t.repo,
    PR_AUTOPILOT_NUMBER: String(t.number),
    PR_AUTOPILOT_URL: t.url,
    PR_AUTOPILOT_TITLE: t.title,
    PR_AUTOPILOT_REASON: t.reason,
    PR_AUTOPILOT_HEAD: t.head ?? "",
    PR_AUTOPILOT_JSON: JSON.stringify(t),
  };
}

export async function notify(
  t: LoggedTransition,
  cfg: Config,
  runner: CommandRunner,
  log: (m: string) => void,
) {
  for (const target of cfg.notify) {
    if (!target.on.includes(t.kind)) continue;
    try {
      const r = await runner.run(target.command, transitionEnv(t), JSON.stringify(t));
      if (r.code !== 0) log(`notify command exited ${r.code}: ${r.stderr.trim()}`);
    } catch (e) {
      log(`notify command failed: ${(e as Error).message}`);
    }
  }
}
