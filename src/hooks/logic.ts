import { join, resolve } from "node:path";
import { defaultConfig, type Config } from "../config/schema.ts";
import { decideStop, actionItemsFor, viewsInScope, type TrackedView } from "../core/stop.ts";
import type { Health } from "../daemon/control.ts";

export interface HookState {
  health: Health | null;
  views: TrackedView[];
  config: Config | null;
  sessionId: string | null;
  playbook: string;
}

const defaults = () => defaultConfig(["owner/repo"]);

function stateLabel(v: TrackedView) {
  const e = v.evaluation;
  if (e.state !== "OPEN") return e.state.toLowerCase();
  return e.ready ? "ready" : e.awaitingHuman ? "awaiting_human" : "not_ready";
}

function daemonLine(h: Health | null) {
  return h
    ? `pr-autopilot daemon is running (pid ${h.pid}, ${h.source.name} ${h.source.state}).`
    : "pr-autopilot daemon is not running, so PR events are not being watched. Start it with `pr-autopilot daemon start`.";
}

export function sessionStartContext(s: HookState): string | null {
  const cfg = s.config ?? defaults();
  if (!cfg.hooks.sessionStart.enabled) return null;
  const repos = s.config?.repos ?? [];
  const mine = new Set(viewsInScope(s.views, "session", { sessionId: s.sessionId, repos }));
  const scoped = s.views.filter(
    (v) => mine.has(v) || viewsInScope([v], "repo", { sessionId: s.sessionId, repos }).length,
  );
  if (!s.config && !scoped.length) return null;
  const lines = [daemonLine(s.health)];
  if (scoped.length) {
    lines.push("Tracked PRs:");
    for (const v of scoped) {
      const e = v.evaluation;
      lines.push(`- ${e.repo}#${e.number} [${stateLabel(v)}] ${e.title}`.trimEnd());
      if (!e.ready && e.reasons.length)
        lines.push(
          `  blocking: ${e.reasons
            .slice(0, 4)
            .map((r) => `${r.code}: ${r.detail}`)
            .join("; ")}`,
        );
    }
  } else {
    lines.push("No PRs are tracked for this project yet; /pr-autopilot:ship opens and tracks one.");
  }
  const items = scoped.flatMap((v) => actionItemsFor(v, cfg.hooks.stop));
  if (items.length) {
    lines.push("Actionable now:");
    for (const i of items) lines.push(`- ${i.pr} ${i.kind}: ${i.detail}. Next: ${i.next}`);
  }
  lines.push(`React to pr-autopilot events using ${s.playbook}.`);
  return lines.join("\n");
}

export function stopHook(s: HookState & { stopHookActive: boolean; priorBlocks: number }): {
  output: object | null;
  blocks: number;
} {
  const cfg = (s.config ?? defaults()).hooks.stop;
  if (!cfg.enabled) return { output: null, blocks: 0 };
  const scoped = viewsInScope(s.views, cfg.scope, {
    sessionId: s.sessionId,
    repos: s.config?.repos ?? [],
  });
  if (!scoped.length) return { output: null, blocks: 0 };
  if (!s.health) {
    return {
      output: {
        systemMessage:
          "pr-autopilot: the daemon is not running, so tracked PR state may be stale; start it with `pr-autopilot daemon start`.",
      },
      blocks: 0,
    };
  }
  const items = scoped.flatMap((v) => actionItemsFor(v, cfg));
  const d = decideStop({
    items,
    stopHookActive: s.stopHookActive,
    priorBlocks: s.priorBlocks,
    maxBlocks: cfg.maxBlocks,
  });
  if (d.decision === "block")
    return {
      output: { decision: "block", reason: `${d.reason}\nUse ${s.playbook}.` },
      blocks: d.blocks,
    };
  if (d.systemMessage) return { output: { systemMessage: d.systemMessage }, blocks: d.blocks };
  return { output: null, blocks: d.blocks };
}

export function shipContext(o: {
  config: Config | null;
  configPath: string | null;
  root: string;
  health: Health | null;
  exists: (path: string) => boolean;
}) {
  const cfg = o.config ?? defaults();
  const files = cfg.standards.files.map((f) => ({ f, abs: resolve(o.root, f) }));
  const present = files.filter((x) => o.exists(x.abs));
  const missing = files.filter((x) => !o.exists(x.abs));
  const rr = cfg.reviewRequest;
  const review =
    rr.command && rr.instruction
      ? "command and instruction"
      : rr.command
        ? "command"
        : rr.instruction
          ? "instruction"
          : null;
  const am = cfg.autoMerge;
  const lines = [
    o.config
      ? `- Config: ${o.configPath} (${o.config.repos.join(", ")})`
      : "- Config: none found; run `pr-autopilot init` to create one",
    present.length
      ? `- Read before implementing: ${present.map((x) => x.abs).join(", ")}`
      : "- Read before implementing: no standards files found",
    ...(missing.length ? [`- Not present: ${missing.map((x) => x.f).join(", ")}`] : []),
    cfg.standards.skills.length
      ? `- Load these skills first: ${cfg.standards.skills.join(", ")}`
      : "- Load these skills first: none configured",
    cfg.standards.prBodyTemplate
      ? `- PR body template: ${join(o.root, cfg.standards.prBodyTemplate)}`
      : "- PR body template: none; match the conventions of recently merged PRs",
    review
      ? `- Review request: ${review} (${rr.instruction ? "shown" : "run"} by \`pr-autopilot request-review\`)`
      : "- Review request: none configured; ask the user who reviews",
    am.default
      ? "- Auto-merge: on for every tracked PR"
      : `- Auto-merge: off unless the user asks${am.labels.length ? ` or the PR has a label in [${am.labels.join(", ")}]` : ""}`,
    o.health
      ? `- Daemon: running (${o.health.source.name} ${o.health.source.state})`
      : "- Daemon: not running; start it with `pr-autopilot daemon start`",
  ];
  return lines.join("\n");
}
