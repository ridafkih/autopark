import type {
  CheckContext,
  CheckOutcome,
  Mergeable,
  PullRequestComment,
  PullRequestState,
  Snapshot,
} from "../core/types.ts";

const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const STATUS_PENDING = new Set(["PENDING", "EXPECTED"]);

export function checkRunOutcome(status: string, conclusion: string | null): CheckOutcome {
  if (status !== "COMPLETED" || !conclusion) return "pending";
  return PASS.has(conclusion) ? "pass" : "fail";
}

export function statusOutcome(state: string): CheckOutcome {
  if (state === "SUCCESS") return "pass";
  if (STATUS_PENDING.has(state)) return "pending";
  return "fail";
}

const mergeableOf = (v: unknown): Mergeable =>
  v === "MERGEABLE" || v === "CONFLICTING" ? v : "UNKNOWN";

export function normalizePullRequest(repo: string, pr: any): Snapshot {
  const commit = pr.commits?.nodes?.[0]?.commit;
  const contexts: any[] = commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const checks: CheckContext[] = contexts.map((c) =>
    c.__typename === "StatusContext"
      ? {
          name: c.context,
          kind: "status",
          outcome: statusOutcome(c.state),
          conclusion: c.state,
          isRequired: !!c.isRequired,
          app: null,
          url: c.targetUrl ?? null,
        }
      : {
          name: c.name,
          kind: "check",
          outcome: checkRunOutcome(c.status, c.conclusion),
          conclusion: c.conclusion ?? c.status,
          isRequired: !!c.isRequired,
          app: c.checkSuite?.app?.slug ?? null,
          url: c.detailsUrl ?? null,
        },
  );
  const seen = new Set<string>();
  const comments: PullRequestComment[] = [];
  for (const c of [
    ...(pr.firstComments?.nodes ?? []),
    ...(pr.lastComments?.nodes ?? []),
    ...(pr.comments?.nodes ?? []),
  ]) {
    const id = String(c.id ?? c.databaseId);
    if (seen.has(id)) continue;
    seen.add(id);
    comments.push({
      id,
      author: c.author?.login ?? null,
      body: c.body ?? "",
      updatedAt: c.updatedAt ?? "",
    });
  }
  const state: PullRequestState =
    pr.state === "MERGED" || pr.merged ? "MERGED" : pr.state === "CLOSED" ? "CLOSED" : "OPEN";
  return {
    repo,
    number: pr.number,
    title: pr.title ?? "",
    url: pr.url ?? `https://github.com/${repo}/pull/${pr.number}`,
    state,
    isDraft: !!pr.isDraft,
    author: pr.author?.login ?? null,
    headRef: pr.headRefName ?? "",
    baseRef: pr.baseRefName ?? "",
    headSha: (pr.headRefOid ?? commit?.oid ?? "").toLowerCase(),
    baseSha: pr.baseRef?.target?.oid?.toLowerCase() ?? null,
    baseComparison: null,
    labels: (pr.labels?.nodes ?? []).map((l: any) => l.name),
    mergeable: mergeableOf(pr.mergeable),
    mergeStateStatus: pr.mergeStateStatus ?? "UNKNOWN",
    checks,
    approvals: (pr.latestOpinionatedReviews?.nodes ?? []).map((r: any) => ({
      login: r.author?.login ?? "ghost",
      state: r.state,
      sha: r.commit?.oid?.toLowerCase() ?? null,
    })),
    threads: (pr.reviewThreads?.nodes ?? []).map((t: any) => ({
      id: t.id,
      resolved: !!t.isResolved,
      outdated: !!t.isOutdated,
      author: t.comments?.nodes?.[0]?.author?.login ?? null,
      path: t.path ?? t.comments?.nodes?.[0]?.path ?? null,
      url: t.comments?.nodes?.[0]?.url ?? null,
    })),
    comments,
  };
}
