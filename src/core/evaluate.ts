import type { Config } from "../config/schema.ts";
import type { ReviewerParser } from "../reviewers/types.ts";
import { loginMatches } from "../reviewers/index.ts";
import type {
  CheckContext,
  CheckOutcome,
  Evaluation,
  FailedCheck,
  Reason,
  ReviewerEval,
  ReviewerResult,
  Snapshot,
} from "./types.ts";

const MERGE_NOW_STATES = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);
const HUMAN_ONLY = new Set(["approval_missing", "approval_stale"]);

export function shaMatches(a: string | null, b: string | null) {
  if (!a || !b || a.length < 7 || b.length < 7) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

function worst(cs: CheckContext[]): { outcome: CheckOutcome; context: CheckContext } {
  const pending = cs.find((c) => c.outcome === "pending");
  if (pending) return { outcome: "pending", context: pending };
  const failed = cs.find((c) => c.outcome === "fail");
  if (failed) return { outcome: "fail", context: failed };
  return { outcome: "pass", context: cs[cs.length - 1]! };
}

function evaluateChecks(s: Snapshot, cfg: Config) {
  const ignore = new Set(cfg.checks.ignore);
  const gates = new Set(cfg.checks.humanGates);
  const byName = new Map<string, CheckContext[]>();
  for (const c of s.checks) {
    if (ignore.has(c.name)) continue;
    byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  }
  const required = new Set(cfg.checks.required.filter((n) => !gates.has(n) && !ignore.has(n)));
  if (cfg.checks.useGitHubRequired) {
    for (const [name, cs] of byName)
      if (!gates.has(name) && cs.some((c) => c.isRequired)) required.add(name);
  }
  const requiredSet = required.size
    ? required
    : new Set([...byName.keys()].filter((n) => !gates.has(n)));

  const failed: FailedCheck[] = [];
  for (const [name, cs] of byName) {
    if (gates.has(name)) continue;
    const w = worst(cs);
    if (w.outcome === "fail")
      failed.push({
        name,
        conclusion: w.context.conclusion,
        required: requiredSet.has(name),
        url: w.context.url,
      });
  }
  const pendingRequired = [...requiredSet].filter((n) => {
    const cs = byName.get(n);
    return !cs || worst(cs).outcome === "pending";
  });
  const gateStates = cfg.checks.humanGates.map((name) => {
    const cs = byName.get(name);
    if (!cs) return { name, outcome: "missing" as const, conclusion: "MISSING" };
    const w = worst(cs);
    return { name, outcome: w.outcome, conclusion: w.context.conclusion };
  });
  const requiredGreen = !failed.some((f) => f.required) && pendingRequired.length === 0;
  return { failed, pendingRequired, gates: gateStates, requiredGreen };
}

function evaluateReviewers(
  s: Snapshot,
  cfg: Config,
  parsers: Map<string, ReviewerParser>,
): ReviewerEval[] {
  return cfg.reviewers.map((r) => {
    const parser = parsers.get(r.name);
    const logins = r.logins.length ? r.logins : (parser?.defaultLogins ?? []);
    let best: { result: ReviewerResult; updatedAt: string } | null = null;
    if (parser) {
      for (const c of s.comments) {
        if (logins.length && !loginMatches(c.author, logins)) continue;
        const result = parser.parse(c, r.options);
        if (result && (!best || c.updatedAt >= best.updatedAt))
          best = { result, updatedAt: c.updatedAt };
      }
    }
    const res = best?.result ?? {
      score: null,
      maxScore: null,
      reviewedSha: null,
      reviewsCount: null,
      commentId: null,
    };
    const onHead = r.requireOnHead ? shaMatches(res.reviewedSha, s.headSha) : true;
    const meetsThreshold = res.score !== null && (r.minScore === null || res.score >= r.minScore);
    return {
      ...res,
      name: r.name,
      present: !!best,
      onHead,
      required: r.required,
      minScore: r.minScore,
      meetsThreshold,
    };
  });
}

function evaluateBase(s: Snapshot, cfg: Config): Evaluation["base"] & { unknown: boolean } {
  const { policy, maxBehind, paths } = cfg.readiness.baseFreshness;
  const cmp = s.baseComparison;
  const base = {
    sha: s.baseSha,
    behindBy: cmp?.behindBy ?? null,
    touched: [] as string[],
    stale: false,
    policy,
    unknown: false,
  };
  if (policy === "off" || s.state !== "OPEN") return base;
  if (!cmp) return { ...base, unknown: true };
  if (policy === "contains-tip") base.stale = cmp.behindBy > 0;
  if (policy === "max-behind") base.stale = cmp.behindBy > maxBehind;
  if (policy === "paths" && cmp.behindBy > 0) {
    const globs = paths.map((p) => new Bun.Glob(p));
    base.touched = cmp.files.filter((f) => globs.some((g) => g.match(f)));
    base.stale = base.touched.length > 0 || cmp.truncated;
  }
  return base;
}

function staleDetail(s: Snapshot, b: Evaluation["base"]) {
  const where = `${s.baseRef}${b.sha ? ` @ ${b.sha.slice(0, 7)}` : ""}`;
  if (b.policy === "paths") {
    const touched = b.touched.length
      ? `touched ${b.touched.slice(0, 5).join(", ")}${b.touched.length > 5 ? ", …" : ""}`
      : "changed files beyond the compare limit";
    return `${where} moved ${b.behindBy} commit(s) and ${touched}; merge ${s.baseRef} in and re-run checks`;
  }
  return `head is ${b.behindBy} commit(s) behind ${where}; merge ${s.baseRef} in and re-run checks`;
}

export function evaluate(
  s: Snapshot,
  cfg: Config,
  parsers: Map<string, ReviewerParser>,
  prev: Evaluation | null,
): Evaluation {
  const rd = cfg.readiness;
  const reasons: Reason[] = [];
  const add = (code: Reason["code"], detail: string) => reasons.push({ code, detail });

  if (s.state !== "OPEN") add("closed", `PR is ${s.state.toLowerCase()}`);
  if (s.isDraft && !rd.allowDraft) add("draft", "PR is a draft");
  if (rd.noConflict) {
    if (s.mergeable === "CONFLICTING") add("conflict", `conflicts with ${s.baseRef}`);
    else if (s.mergeable === "UNKNOWN" && s.state === "OPEN")
      add("mergeability_unknown", "GitHub has not computed mergeability yet");
  }

  const { unknown: baseUnknown, ...base } = evaluateBase(s, cfg);
  if (base.stale) add("stale_base", staleDetail(s, base));
  else if (baseUnknown) add("base_unknown", `could not compare head with ${s.baseRef}`);

  const checks = evaluateChecks(s, cfg);
  if (rd.requiredChecksPass) {
    const failedRequired = checks.failed.filter((f) => f.required);
    if (failedRequired.length)
      add(
        "checks_failed",
        `required checks failed: ${failedRequired.map((f) => f.name).join(", ")}`,
      );
    if (checks.pendingRequired.length)
      add("checks_pending", `required checks pending: ${checks.pendingRequired.join(", ")}`);
  }

  const reviewers = evaluateReviewers(s, cfg, parsers);
  for (const r of reviewers) {
    if (!r.required) continue;
    if (!r.present || r.score === null) add("review_missing", `${r.name} has not scored this PR`);
    else if (!r.onHead)
      add(
        "review_stale",
        `${r.name} scored ${r.reviewedSha?.slice(0, 7) ?? "an unknown commit"}, not head ${s.headSha.slice(0, 7)}`,
      );
    else if (!r.meetsThreshold)
      add(
        "review_below_threshold",
        `${r.name} scored ${r.score}${r.maxScore ? `/${r.maxScore}` : ""}, needs ${r.minScore}`,
      );
  }

  const threadsOpen = s.threads.filter(
    (t) => !t.resolved && (rd.countOutdatedThreads || !t.outdated),
  ).length;
  if (rd.noUnresolvedThreads && threadsOpen > 0)
    add("threads_open", `${threadsOpen} unresolved review thread(s)`);

  const approved = s.approvals.filter((a) => a.state === "APPROVED");
  const onHead = approved.filter((a) => shaMatches(a.sha, s.headSha)).map((a) => a.login);
  const stale = approved.filter((a) => !shaMatches(a.sha, s.headSha)).map((a) => a.login);
  const changesRequested = s.approvals
    .filter((a) => a.state === "CHANGES_REQUESTED")
    .map((a) => a.login);
  if (changesRequested.length)
    add("changes_requested", `changes requested by ${changesRequested.join(", ")}`);
  const counted = rd.approvalOnHead ? onHead.length : onHead.length + stale.length;
  if (counted < rd.minApprovals) {
    if (rd.approvalOnHead && stale.length)
      add("approval_stale", `approval by ${stale.join(", ")} is on an older commit`);
    else add("approval_missing", `needs ${rd.minApprovals} approval(s) on head, has ${counted}`);
  }

  const ready = reasons.length === 0;
  const gatesPass = checks.gates.every((g) => g.outcome === "pass");
  const lastKnownMergeable =
    s.mergeable !== "UNKNOWN" ? s.mergeable : (prev?.lastKnownMergeable ?? "UNKNOWN");

  return {
    repo: s.repo,
    number: s.number,
    title: s.title,
    url: s.url,
    state: s.state,
    isDraft: s.isDraft,
    headRef: s.headRef,
    baseRef: s.baseRef,
    headSha: s.headSha,
    labels: s.labels,
    base,
    mergeable: s.mergeable,
    lastKnownMergeable,
    mergeStateStatus: s.mergeStateStatus,
    checks,
    reviewers,
    threadsOpen,
    approvals: { onHead, stale, changesRequested },
    reasons,
    ready,
    mergeableNow: ready && gatesPass && MERGE_NOW_STATES.has(s.mergeStateStatus),
    awaitingHuman: !ready && reasons.every((r) => HUMAN_ONLY.has(r.code)),
  };
}
