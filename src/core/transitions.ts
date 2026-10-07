import type { Evaluation, FailedCheck, Transition, TransitionKind } from "./types.ts";

export interface DiffOptions {
  mergeabilityExhausted?: boolean;
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : "unknown");
const sameHead = (prev: Evaluation | null, next: Evaluation) => !!prev && prev.headSha === next.headSha;
const failedList = (fs: FailedCheck[]) => fs.map((f) => `${f.name} (${f.conclusion})`).join(", ");

function reviewKey(r: Evaluation["reviewers"][number] | undefined) {
  if (!r || r.score === null) return null;
  return `${r.score}@${r.reviewedSha ?? "?"}#${r.reviewsCount ?? "?"}`;
}

export function diff(prev: Evaluation | null, next: Evaluation, opts: DiffOptions = {}): Transition[] {
  const out: Transition[] = [];
  const emit = (kind: TransitionKind, reason: string, data: Record<string, unknown> = {}) =>
    out.push({ kind, repo: next.repo, number: next.number, head: next.headSha || null, reason, data });

  if (next.state !== "OPEN") {
    if (prev?.state !== next.state) {
      if (next.state === "MERGED") emit("merged", `#${next.number} was merged`);
      else emit("closed", `#${next.number} was closed without merging`);
    }
    return out;
  }

  if (prev && prev.headSha !== next.headSha) {
    emit("head_moved", `head moved ${short(prev.headSha)} → ${short(next.headSha)}`, { from: prev.headSha, to: next.headSha });
  }

  const prevKnown = prev?.lastKnownMergeable ?? "UNKNOWN";
  if (next.mergeable === "CONFLICTING" && prevKnown !== "CONFLICTING") {
    emit("conflicted", `conflicts with ${next.baseRef}`, { base: next.baseRef, mergeStateStatus: next.mergeStateStatus });
  } else if (next.mergeable === "MERGEABLE" && prevKnown === "CONFLICTING") {
    emit("conflict_resolved", `no longer conflicts with ${next.baseRef}`, { base: next.baseRef });
  } else if (next.mergeable === "UNKNOWN" && opts.mergeabilityExhausted && prev?.mergeable !== "UNKNOWN") {
    emit("mergeability_unknown", "GitHub did not compute mergeability within the backoff window", { lastKnown: next.lastKnownMergeable });
  }

  if (next.base.stale && !(prev?.base.stale && sameHead(prev, next) && prev.base.sha === next.base.sha)) {
    const r = next.reasons.find((x) => x.code === "stale_base");
    emit("stale_base", r?.detail ?? `behind ${next.baseRef}`, {
      base: next.baseRef,
      baseSha: next.base.sha,
      behindBy: next.base.behindBy,
      touched: next.base.touched,
      policy: next.base.policy,
    });
  }

  const prevFailed = new Set(sameHead(prev, next) ? prev!.checks.failed.map((f) => f.name) : []);
  const newFailed = next.checks.failed.filter((f) => !prevFailed.has(f.name));
  if (newFailed.length) {
    const req = newFailed.filter((f) => f.required);
    const opt = newFailed.filter((f) => !f.required);
    const parts = [req.length ? `required failed: ${failedList(req)}` : "", opt.length ? `optional failed: ${failedList(opt)}` : ""].filter(Boolean);
    emit("checks_failed", parts.join("; "), {
      names: newFailed.map((f) => f.name),
      required: req.map((f) => f.name),
      checks: newFailed,
    });
  }
  if (next.checks.requiredGreen && !(prev?.checks.requiredGreen && sameHead(prev, next))) {
    emit("checks_passed", `required checks passed on ${short(next.headSha)}`);
  }

  for (const r of next.reviewers) {
    const key = reviewKey(r);
    if (key === null || key === reviewKey(prev?.reviewers.find((p) => p.name === r.name))) continue;
    const scoreText = `${r.score}${r.maxScore ? `/${r.maxScore}` : ""}`;
    const where = r.onHead ? "on head" : `on ${short(r.reviewedSha)}, not head ${short(next.headSha)}`;
    emit("review_scored", `${r.name} scored ${scoreText} ${where}`, {
      bot: r.name,
      score: r.score,
      maxScore: r.maxScore,
      minScore: r.minScore,
      head: r.reviewedSha,
      onHead: r.onHead,
      meetsThreshold: r.meetsThreshold,
      reviewsCount: r.reviewsCount,
    });
  }

  const prevThreads = prev?.threadsOpen ?? 0;
  if (next.threadsOpen !== prevThreads) {
    emit("threads_open", next.threadsOpen ? `${next.threadsOpen} unresolved review thread(s)` : "all review threads resolved", {
      count: next.threadsOpen,
      previous: prevThreads,
    });
  }

  const prevOnHead = sameHead(prev, next) && prev!.approvals.onHead.length > 0;
  if (next.approvals.onHead.length && !prevOnHead) {
    emit("approved_on_head", `approved on ${short(next.headSha)} by ${next.approvals.onHead.join(", ")}`, { by: next.approvals.onHead });
  }
  const staleNow = !next.approvals.onHead.length && next.approvals.stale.length > 0;
  const staleBefore = sameHead(prev, next) && !prev!.approvals.onHead.length && prev!.approvals.stale.length > 0;
  if (staleNow && !staleBefore) {
    emit("approval_stale", `approval by ${next.approvals.stale.join(", ")} predates head ${short(next.headSha)}`, { by: next.approvals.stale });
  }

  if (next.awaitingHuman && !(prev?.awaitingHuman && sameHead(prev, next))) {
    emit("awaiting_human", "everything is green except human approval", { reasons: next.reasons });
  }

  if (next.ready && !prev?.ready) {
    emit("ready", next.mergeableNow ? "all readiness rules pass; mergeable now" : "all readiness rules pass", { mergeableNow: next.mergeableNow });
  } else if (!next.ready && (prev === null || prev.ready)) {
    emit("not_ready", next.reasons.map((r) => r.detail).join("; "), { reasons: next.reasons });
  }

  return out;
}
