import { pullRequestKey, type LoggedTransition } from "../core/types.ts";
import { INSTRUCTION_KINDS } from "./still-holds.ts";

function groupByPullRequest(transitions: LoggedTransition[]) {
  const groups = new Map<string, LoggedTransition[]>();
  for (const transition of transitions) {
    const key = pullRequestKey(transition.repo, transition.number);
    groups.set(key, [...(groups.get(key) ?? []), transition]);
  }
  return [...groups.values()];
}

function newestInstructions(group: LoggedTransition[]) {
  const byKind = new Map(
    group
      .filter((transition) => INSTRUCTION_KINDS.has(transition.kind))
      .map((transition) => [transition.kind, transition] as const),
  );
  return [...byKind.values()];
}

function collapseGroup(group: LoggedTransition[]): LoggedTransition[] {
  const newest = group.at(-1);
  if (!newest) return [];
  const kept = new Set([newest, ...newestInstructions(group)]);
  const superseded = [
    ...new Set(group.filter((transition) => !kept.has(transition)).map(({ kind }) => kind)),
  ];
  if (superseded.length === 0) return [...kept];
  const marked = { ...newest, data: { ...newest.data, superseded } };
  return [...kept].map((transition) => (transition === newest ? marked : transition));
}

export const collapseBursts = (transitions: LoggedTransition[]) =>
  groupByPullRequest(transitions)
    .flatMap(collapseGroup)
    .toSorted((left, right) => left.id - right.id);
