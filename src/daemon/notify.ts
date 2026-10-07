import type { Config } from "../config/schema.ts";
import { errorMessage } from "../core/errors.ts";
import type { LoggedTransition } from "../core/types.ts";
import type { CommandRunner } from "./runner.ts";

export function transitionEnv(transition: LoggedTransition): Record<string, string> {
  return {
    AUTOPARK_KIND: transition.kind,
    AUTOPARK_REPO: transition.repo,
    AUTOPARK_NUMBER: String(transition.number),
    AUTOPARK_URL: transition.url,
    AUTOPARK_TITLE: transition.title,
    AUTOPARK_REASON: transition.reason,
    AUTOPARK_HEAD: transition.head ?? "",
    AUTOPARK_JSON: JSON.stringify(transition),
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
