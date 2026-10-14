import type { Config } from "../config/schema.ts";
import { actionItemsFor, actionLines } from "./stop/items.ts";
import type { ActionItem, TrackedView } from "./stop/items.ts";

export type { ActionItem, ActionKind, TrackedView } from "./stop/items.ts";
export { actionItemsFor, actionLines } from "./stop/items.ts";

type StopConfig = Config["hooks"]["stop"];

export interface ScopeContext {
  sessionId: string | null;
  repos: string[];
}

export interface StopDecision {
  decision: "allow" | "block";
  blocks: number;
  reason?: string;
  systemMessage?: string;
}

export interface StopInput {
  items: ActionItem[];
  stopHookActive: boolean;
  priorBlocks: number;
  maxBlocks: number;
}

export function viewsInScope(
  views: TrackedView[],
  scope: StopConfig["scope"],
  context: ScopeContext,
) {
  const repos = new Set(context.repos.map((repo) => repo.toLowerCase()));
  return views.filter((view) => {
    if (scope === "all") return true;
    if (scope === "repo") return repos.has(view.evaluation.repo.toLowerCase());
    return context.sessionId !== null && view.sessionId === context.sessionId;
  });
}

export const isHeld = (view: TrackedView) => view.hold !== null && view.hold !== undefined;

export const actionableItems = (views: TrackedView[], config: StopConfig, context: ScopeContext) =>
  viewsInScope(views, config.scope, context)
    .filter((view) => !isHeld(view))
    .flatMap((view) => actionItemsFor(view, config));

export const STOP_HEADER =
  "Act on these PRs per the autopark playbook; only `autopark hold` pauses PR work.";

export function decideStop({
  items,
  stopHookActive,
  priorBlocks,
  maxBlocks,
}: StopInput): StopDecision {
  if (items.length === 0) return { decision: "allow", blocks: 0 };
  if (stopHookActive && priorBlocks >= maxBlocks) {
    const remaining = `${items.length} actionable item(s) remain`;
    return {
      decision: "allow",
      blocks: 0,
      systemMessage: `autopark: stopped blocking after ${priorBlocks} consecutive continuations; ${remaining}.`,
    };
  }
  return {
    decision: "block",
    blocks: stopHookActive ? priorBlocks + 1 : 1,
    reason: [STOP_HEADER, ...actionLines(items)].join("\n"),
  };
}
