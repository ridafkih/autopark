import { defaultConfig, type Config } from "../config/schema.ts";
import type { TrackedView } from "../core/stop.ts";
import type { Health } from "../daemon/control.ts";

export interface HookState {
  health: Health | null;
  views: TrackedView[];
  config: Config | null;
  sessionId: string | null;
  playbook: string;
  now: number;
}

export const configOrDefaults = (config: Config | null) => config ?? defaultConfig(["owner/repo"]);
