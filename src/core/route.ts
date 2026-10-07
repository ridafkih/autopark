import type { Candidate } from "./track.ts";

export interface PullRequestIndex {
  bySha(repo: string, sha: string): number[];
  byHeadRef(repo: string, ref: string): number[];
  byBaseRef(repo: string, ref: string): number[];
}

export interface RouteResult {
  repo: string | null;
  pullRequests: number[];
  candidates: Candidate[];
}

interface WebhookPullRequest {
  number: number;
  user?: { login?: string } | null;
  head?: { ref?: string };
  base?: { ref?: string };
  labels?: Array<{ name: string }>;
  state?: string;
}

interface WebhookCheck {
  pull_requests?: Array<{ number: number }>;
  head_sha?: string;
}

interface WebhookPayload {
  repository?: { full_name?: string };
  pull_request?: WebhookPullRequest;
  issue?: { number: number; pull_request?: unknown };
  check_run?: WebhookCheck;
  check_suite?: WebhookCheck;
  sha?: string;
  ref?: string;
  deleted?: boolean;
}

interface Routed {
  pullRequests: number[];
  candidates: Candidate[];
}

interface RouteInput {
  payload: WebhookPayload;
  repo: string;
  index: PullRequestIndex;
}

type Router = (input: RouteInput) => Routed | null;

const BRANCH_PREFIX = "refs/heads/";

const routed = (pullRequests: number[], candidates: Candidate[] = []): Routed => ({
  pullRequests,
  candidates,
});

const candidateOf = (repo: string, pullRequest: WebhookPullRequest): Candidate => ({
  repo,
  number: pullRequest.number,
  author: pullRequest.user?.login ?? null,
  headRef: pullRequest.head?.ref ?? "",
  baseRef: pullRequest.base?.ref ?? "",
  labels: (pullRequest.labels ?? []).map((label) => label.name),
  open: (pullRequest.state ?? "open") === "open",
});

const routePullRequest: Router = ({ payload: { pull_request: pullRequest }, repo }) =>
  pullRequest ? routed([pullRequest.number], [candidateOf(repo, pullRequest)]) : null;

const routeIssueComment: Router = ({ payload: { issue } }) =>
  routed(issue?.pull_request ? [issue.number] : []);

const routeCheck =
  (check: WebhookCheck | undefined): Router =>
  ({ repo, index }) => {
    const listed = (check?.pull_requests ?? []).map((pullRequest) => pullRequest.number);
    const bySha = check?.head_sha ? index.bySha(repo, check.head_sha) : [];
    return routed([...listed, ...bySha]);
  };

const routeStatus: Router = ({ payload: { sha }, repo, index }) =>
  routed(sha ? index.bySha(repo, sha) : []);

const routePush: Router = ({ payload: { ref = "", deleted }, repo, index }) => {
  if (!ref.startsWith(BRANCH_PREFIX) || deleted) return null;
  const branch = ref.slice(BRANCH_PREFIX.length);
  return routed([...index.byBaseRef(repo, branch), ...index.byHeadRef(repo, branch)]);
};

function routerFor(event: string, payload: WebhookPayload): Router | null {
  switch (event) {
    case "pull_request":
    case "pull_request_review":
    case "pull_request_review_comment":
    case "pull_request_review_thread": {
      return routePullRequest;
    }
    case "issue_comment": {
      return routeIssueComment;
    }
    case "check_run":
    case "check_suite": {
      return routeCheck(payload[event]);
    }
    case "status": {
      return routeStatus;
    }
    case "push": {
      return routePush;
    }
    default: {
      return null;
    }
  }
}

export function route(event: string, payload: unknown, index: PullRequestIndex): RouteResult {
  const body = (payload ?? {}) as WebhookPayload;
  const repo = body.repository?.full_name?.toLowerCase() ?? null;
  const router = routerFor(event, body);
  const result = repo && router ? router({ payload: body, repo, index }) : null;
  return {
    repo,
    pullRequests: [...new Set(result?.pullRequests)],
    candidates: result?.candidates ?? [],
  };
}
