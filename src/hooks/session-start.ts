import { actionItemsFor, viewsInScope, type TrackedView } from "../core/stop.ts";
import { formatPullRequest } from "../core/format.ts";
import { stateLabel } from "../core/summary.ts";
import type { Health } from "../daemon/control.ts";
import { configOrDefaults, type HookState } from "./state.ts";

const MAX_BLOCKING_REASONS = 4;

function daemonLine(health: Health | null) {
  if (!health) {
    return "autopark daemon is not running, so PR events are not being watched. Start it with `autopark daemon start`.";
  }
  const source = `${health.source.name} ${health.source.state}`;
  return `autopark daemon is running (pid ${health.pid}, ${source}).`;
}

function viewLines({ evaluation }: TrackedView) {
  const heading = `- ${formatPullRequest(evaluation)} [${stateLabel(evaluation)}] ${evaluation.title}`;
  if (evaluation.ready || evaluation.reasons.length === 0) return [heading.trimEnd()];
  const blocking = evaluation.reasons
    .slice(0, MAX_BLOCKING_REASONS)
    .map((reason) => `${reason.code}: ${reason.detail}`)
    .join("; ");
  return [heading.trimEnd(), `  blocking: ${blocking}`];
}

function trackedLines(views: TrackedView[]) {
  if (views.length === 0) {
    return ["No PRs are tracked for this project yet; /autopark:ship opens and tracks one."];
  }
  return ["Tracked PRs:", ...views.flatMap(viewLines)];
}

function scopedViews(state: HookState) {
  const scope = { sessionId: state.sessionId, repos: state.config?.repos ?? [] };
  const inSession = new Set(viewsInScope(state.views, "session", scope));
  const inRepo = new Set(viewsInScope(state.views, "repo", scope));
  return state.views.filter((view) => inSession.has(view) || inRepo.has(view));
}

export function sessionStartContext(state: HookState): string | null {
  const config = configOrDefaults(state.config);
  if (!config.hooks.sessionStart.enabled) return null;
  const scoped = scopedViews(state);
  if (!state.config && scoped.length === 0) return null;
  const items = scoped.flatMap((view) => actionItemsFor(view, config.hooks.stop));
  const actionable = items.map(
    (item) => `- ${item.pr} ${item.kind}: ${item.detail}. Next: ${item.next}`,
  );
  return [
    daemonLine(state.health),
    ...trackedLines(scoped),
    ...(actionable.length > 0 ? ["Actionable now:", ...actionable] : []),
    `React to autopark events using ${state.playbook}.`,
  ].join("\n");
}
