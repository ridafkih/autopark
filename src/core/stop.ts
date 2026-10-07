import type { Config } from "../config/schema.ts";
import type { Evaluation } from "./types.ts";

export interface TrackedView {
  evaluation: Evaluation;
  sessionId: string | null;
  reviewRequestedHead: string | null;
}

export type ActionKind = "conflict" | "stale_base" | "failed_checks" | "review_findings" | "review_not_requested";

export interface ActionItem {
  pr: string;
  kind: ActionKind;
  detail: string;
  next: string;
}

type StopConfig = Config["hooks"]["stop"];

const detailOf = (e: Evaluation, ...codes: string[]) =>
  e.reasons
    .filter((r) => codes.includes(r.code))
    .map((r) => r.detail)
    .join("; ");

export function itemsFor(v: TrackedView, cfg: StopConfig): ActionItem[] {
  const e = v.evaluation;
  if (e.state !== "OPEN") return [];
  const pr = `${e.repo}#${e.number}`;
  const out: ActionItem[] = [];
  if (cfg.blockOnConflict && e.mergeable === "CONFLICTING") {
    out.push({ pr, kind: "conflict", detail: `conflicts with ${e.baseRef}`, next: `merge ${e.baseRef} into the branch, resolve, push.` });
  }
  if (cfg.blockOnStaleBase && e.base.stale) {
    out.push({ pr, kind: "stale_base", detail: detailOf(e, "stale_base"), next: `merge ${e.baseRef} in so required checks run against the current base, push.` });
  }
  const failedRequired = e.checks.failed.filter((f) => f.required);
  if (cfg.blockOnFailedChecks && failedRequired.length) {
    out.push({
      pr,
      kind: "failed_checks",
      detail: `required checks failed: ${failedRequired.map((f) => `${f.name} (${f.conclusion})`).join(", ")}`,
      next: "read the failing logs, fix, push.",
    });
  }
  if (cfg.blockOnReviewFindings) {
    const low = e.reviewers.filter((r) => r.required && r.onHead && r.score !== null && !r.meetsThreshold);
    const parts = low.map((r) => `${r.name} scored ${r.score}${r.maxScore ? `/${r.maxScore}` : ""} on head, needs ${r.minScore}`);
    if (e.threadsOpen > 0 && e.reasons.some((r) => r.code === "threads_open")) parts.push(`${e.threadsOpen} unresolved review thread(s)`);
    if (parts.length) out.push({ pr, kind: "review_findings", detail: parts.join("; "), next: "address the findings, reply to and resolve each thread, push." });
  }
  if (cfg.blockOnHeadMovedWithoutReview) {
    const needsApproval = e.reasons.some((r) => r.code === "approval_missing" || r.code === "approval_stale");
    const requestedOnHead = v.reviewRequestedHead === e.headSha;
    if (needsApproval && !requestedOnHead && (v.reviewRequestedHead !== null || e.awaitingHuman)) {
      out.push({
        pr,
        kind: "review_not_requested",
        detail: `head ${e.headSha.slice(0, 7)} has no review request`,
        next: `request review (pr-autopilot request-review ${pr}).`,
      });
    }
  }
  return out;
}

export interface ScopeContext {
  sessionId: string | null;
  repos: string[];
}

export function viewsInScope(views: TrackedView[], scope: "session" | "repo" | "all", ctx: ScopeContext) {
  const repos = ctx.repos.map((r) => r.toLowerCase());
  return views.filter((v) => {
    if (scope === "all") return true;
    if (scope === "repo") return repos.includes(v.evaluation.repo.toLowerCase());
    return !!ctx.sessionId && v.sessionId === ctx.sessionId;
  });
}

export function actionableItems(views: TrackedView[], cfg: StopConfig, ctx: ScopeContext) {
  return viewsInScope(views, cfg.scope, ctx).flatMap((v) => itemsFor(v, cfg));
}

export interface StopDecision {
  decision: "allow" | "block";
  blocks: number;
  reason?: string;
  systemMessage?: string;
}

export function decideStop(input: { items: ActionItem[]; stopHookActive: boolean; priorBlocks: number; maxBlocks: number }): StopDecision {
  const { items, stopHookActive, priorBlocks, maxBlocks } = input;
  if (!items.length) return { decision: "allow", blocks: 0 };
  if (stopHookActive && priorBlocks >= maxBlocks) {
    return {
      decision: "allow",
      blocks: 0,
      systemMessage: `pr-autopilot: stopped blocking after ${priorBlocks} consecutive continuations; ${items.length} actionable item(s) remain.`,
    };
  }
  const lines = items.map((i) => `- ${i.pr} ${i.kind}: ${i.detail}. Next: ${i.next}`);
  return {
    decision: "block",
    blocks: stopHookActive ? priorBlocks + 1 : 1,
    reason: `Tracked PRs have actionable items:\n${lines.join("\n")}`,
  };
}
