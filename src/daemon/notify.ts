import type { Config } from "../config/schema.ts";
import { errorMessage } from "../core/errors.ts";
import type { LoggedTransition } from "../core/types.ts";
import type { CommandRunner } from "./runner.ts";

export function transitionEnv(transition: LoggedTransition): Record<string, string> {
  return {
    PR_AUTOPILOT_KIND: transition.kind,
    PR_AUTOPILOT_REPO: transition.repo,
    PR_AUTOPILOT_NUMBER: String(transition.number),
    PR_AUTOPILOT_URL: transition.url,
    PR_AUTOPILOT_TITLE: transition.title,
    PR_AUTOPILOT_REASON: transition.reason,
    PR_AUTOPILOT_HEAD: transition.head ?? "",
    PR_AUTOPILOT_JSON: JSON.stringify(transition),
  };
}

export async function notify(
  transition: LoggedTransition,
  config: Config,
  runner: CommandRunner,
  log: (message: string) => void,
) {
  const targets = config.notify.filter((target) => target.on.includes(transition.kind));
  for (const target of targets) {
    try {
      const json = JSON.stringify(transition);
      const result = await runner.run(target.command, transitionEnv(transition), json);
      if (result.code !== 0) log(`notify command exited ${result.code}: ${result.stderr.trim()}`);
    } catch (error) {
      log(`notify command failed: ${errorMessage(error)}`);
    }
  }
}
