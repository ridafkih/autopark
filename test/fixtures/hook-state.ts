import { evaluate } from "../../src/core/evaluate.ts";
import type { TrackedView } from "../../src/core/stop.ts";
import type { Snapshot } from "../../src/core/types.ts";
import type { HookState } from "../../src/hooks/state.ts";
import { greptile } from "../../src/reviewers/greptile.ts";
import { config, snapshot } from "./build.ts";

const parsers = new Map([["greptile", greptile]]);
const defaultConfig = config();

export const PLAYBOOK = "the autopark:autopark skill";

export const health = {
  ok: true as const,
  pid: 99,
  startedAt: "t",
  version: "0.1.0",
  repos: ["acme/widgets"],
  source: { name: "gh-webhook-forward", state: "connected" as const, detail: "" },
};

export const view = (changes: Partial<Snapshot>, sessionId: string | null = "s1"): TrackedView => ({
  evaluation: evaluate(snapshot(changes), defaultConfig, parsers, null),
  sessionId,
  reviewRequestedHead: null,
});

export const hookState = (overrides: Partial<HookState> = {}): HookState => ({
  health,
  views: [view({})],
  config: defaultConfig,
  sessionId: "s1",
  playbook: PLAYBOOK,
  ...overrides,
});
