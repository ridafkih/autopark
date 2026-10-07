import { formatDuration, formatRemaining } from "../core/duration.ts";
import { formatPullRequest } from "../core/format.ts";
import { PAUSE_RULE } from "../core/nudge-message.ts";
import { actionItemsFor, isHeld, viewsInScope, type TrackedView } from "../core/stop.ts";
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

const stuckSince = ({ evaluation, nudge }: TrackedView) =>
  evaluation.ready || evaluation.state !== "OPEN" || !nudge ? null : nudge.since;

function holdLines({ hold }: TrackedView, now: number) {
  if (!hold) return [];
  const scope = hold.scope === "all" ? " (every PR)" : "";
  const why = hold.reason ? `: ${hold.reason}` : "";
  const remaining = formatRemaining(hold.until - now);
  return [`  held ${remaining} more${scope}${why}`];
}

function stuckLines(view: TrackedView, now: number) {
  const since = stuckSince(view);
  if (since === null) return [];
  const count = view.nudge?.count ?? 0;
  const nudged = count > 0 ? `, nudged ${count}x` : "";
  const stuck = formatDuration(now - since);
  return [`  stuck ${stuck}${nudged}`];
}

function viewLines(view: TrackedView, now: number) {
  const { evaluation } = view;
  const heading = `- ${formatPullRequest(evaluation)} [${stateLabel(evaluation)}] ${evaluation.title}`;
  const status = [heading.trimEnd(), ...holdLines(view, now), ...stuckLines(view, now)];
  if (evaluation.ready || evaluation.reasons.length === 0) return status;
  const blocking = evaluation.reasons
    .slice(0, MAX_BLOCKING_REASONS)
    .map((reason) => `${reason.code}: ${reason.detail}`)
    .join("; ");
  return [...status, `  blocking: ${blocking}`];
}

const oldestStuckFirst = (left: TrackedView, right: TrackedView) =>
  (stuckSince(left) ?? Number.POSITIVE_INFINITY) - (stuckSince(right) ?? Number.POSITIVE_INFINITY);

function trackedLines(views: TrackedView[], now: number) {
  if (views.length === 0) {
    return ["No PRs are tracked for this project yet; /autopark:ship opens and tracks one."];
  }
  const ordered = views.toSorted(oldestStuckFirst);
  return ["Tracked PRs:", ...ordered.flatMap((view) => viewLines(view, now))];
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
  const items = scoped
    .filter((view) => !isHeld(view))
    .flatMap((view) => actionItemsFor(view, config.hooks.stop));
  const actionable = items.map(
    (item) => `- ${item.pr} ${item.kind}: ${item.detail}. Next: ${item.next}`,
  );
  return [
    daemonLine(state.health),
    ...trackedLines(scoped, state.now),
    ...(actionable.length > 0 ? ["Actionable now:", ...actionable] : []),
    `React to autopark events using ${state.playbook}. ${PAUSE_RULE}`,
  ].join("\n");
}
