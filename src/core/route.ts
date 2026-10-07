import type { Candidate } from "./track.ts";

export interface PrIndex {
  bySha(repo: string, sha: string): number[];
  byHeadRef(repo: string, ref: string): number[];
  byBaseRef(repo: string, ref: string): number[];
}

export interface RouteResult {
  repo: string | null;
  prs: number[];
  candidates: Candidate[];
}

const PR_EVENTS = new Set([
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
]);

function candidateOf(repo: string, pr: any): Candidate {
  return {
    repo,
    number: pr.number,
    author: pr.user?.login ?? null,
    headRef: pr.head?.ref ?? "",
    baseRef: pr.base?.ref ?? "",
    labels: (pr.labels ?? []).map((l: any) => l.name),
    open: (pr.state ?? "open") === "open",
  };
}

export function route(event: string, payload: any, index: PrIndex): RouteResult {
  const repo: string | null = payload?.repository?.full_name?.toLowerCase() ?? null;
  const none: RouteResult = { repo, prs: [], candidates: [] };
  if (!repo) return none;
  const prs = new Set<number>();
  const candidates: Candidate[] = [];

  if (PR_EVENTS.has(event) && payload.pull_request) {
    prs.add(payload.pull_request.number);
    candidates.push(candidateOf(repo, payload.pull_request));
  } else if (event === "issue_comment") {
    if (payload.issue?.pull_request) prs.add(payload.issue.number);
  } else if (event === "check_run" || event === "check_suite") {
    const body = payload[event] ?? {};
    for (const p of body.pull_requests ?? []) prs.add(p.number);
    if (body.head_sha) for (const n of index.bySha(repo, body.head_sha)) prs.add(n);
  } else if (event === "status") {
    if (payload.sha) for (const n of index.bySha(repo, payload.sha)) prs.add(n);
  } else if (event === "push") {
    const ref: string = payload.ref ?? "";
    if (!ref.startsWith("refs/heads/") || payload.deleted) return none;
    const branch = ref.slice("refs/heads/".length);
    for (const n of index.byBaseRef(repo, branch)) prs.add(n);
    for (const n of index.byHeadRef(repo, branch)) prs.add(n);
  } else {
    return none;
  }
  return { repo, prs: [...prs], candidates };
}
