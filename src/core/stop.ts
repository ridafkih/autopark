import type { Config } from "../config/schema.ts";
import { actionItemsFor } from "./stop/items.ts";
import type { ActionItem, TrackedView } from "./stop/items.ts";

export type { ActionItem, ActionKind, TrackedView } from "./stop/items.ts";
export { actionItemsFor } from "./stop/items.ts";

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

export const actionableItems = (views: TrackedView[], config: StopConfig, context: ScopeContext) =>
  viewsInScope(views, config.scope, context).flatMap((view) => actionItemsFor(view, config));

const describeItem = (item: ActionItem) =>
  `- ${item.pr} ${item.kind}: ${item.detail}. Next: ${item.next}`;

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
      systemMessage: `pr-autopilot: stopped blocking after ${priorBlocks} consecutive continuations; ${remaining}.`,
    };
  }
  const lines = items.map(describeItem).join("\n");
  return {
    decision: "block",
    blocks: stopHookActive ? priorBlocks + 1 : 1,
    reason: `Tracked PRs have actionable items:\n${lines}`,
  };
}
