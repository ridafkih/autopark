import { isRecord, numberAt, recordsAt, stringAt, valueAt, type JsonRecord } from "./json.ts";
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

interface Routed {
  pullRequests: number[];
  candidates: Candidate[];
}

interface RouteInput {
  payload: unknown;
  repo: string;
  index: PullRequestIndex;
}

type Router = (input: RouteInput) => Routed | null;

const BRANCH_PREFIX = "refs/heads/";

const routed = (pullRequests: number[], candidates: Candidate[] = []): Routed => ({
  pullRequests,
  candidates,
});

const labelNames = (pullRequest: JsonRecord) =>
  recordsAt(pullRequest, "labels").flatMap((label) => {
    const name = stringAt(label, "name");
    return name === undefined ? [] : [name];
  });

const candidateOf = (repo: string, pullRequest: JsonRecord, number: number): Candidate => ({
  repo,
  number,
  author: stringAt(pullRequest, "user", "login") ?? null,
  headRef: stringAt(pullRequest, "head", "ref") ?? "",
  baseRef: stringAt(pullRequest, "base", "ref") ?? "",
  labels: labelNames(pullRequest),
  open: (stringAt(pullRequest, "state") ?? "open") === "open",
});

const routePullRequest: Router = ({ payload, repo }) => {
  const pullRequest = valueAt(payload, "pull_request");
  const number = numberAt(pullRequest, "number");
  if (!isRecord(pullRequest) || number === undefined) return null;
  return routed([number], [candidateOf(repo, pullRequest, number)]);
};

const routeIssueComment: Router = ({ payload }) => {
  const number = numberAt(payload, "issue", "number");
  const isPullRequest = Boolean(valueAt(payload, "issue", "pull_request"));
  return routed(isPullRequest && number !== undefined ? [number] : []);
};

const routeCheck =
  (event: string): Router =>
  ({ payload, repo, index }) => {
    const listed = recordsAt(payload, event, "pull_requests").flatMap((pullRequest) => {
      const number = numberAt(pullRequest, "number");
      return number === undefined ? [] : [number];
    });
    const headSha = stringAt(payload, event, "head_sha");
    const bySha = headSha ? index.bySha(repo, headSha) : [];
    return routed([...listed, ...bySha]);
  };

const routeStatus: Router = ({ payload, repo, index }) => {
  const sha = stringAt(payload, "sha");
  return routed(sha ? index.bySha(repo, sha) : []);
};

const routePush: Router = ({ payload, repo, index }) => {
  const ref = stringAt(payload, "ref") ?? "";
  if (!ref.startsWith(BRANCH_PREFIX) || valueAt(payload, "deleted")) return null;
  const branch = ref.slice(BRANCH_PREFIX.length);
  return routed([...index.byBaseRef(repo, branch), ...index.byHeadRef(repo, branch)]);
};

function routerFor(event: string): Router | null {
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
      return routeCheck(event);
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
  const repo = stringAt(payload, "repository", "full_name")?.toLowerCase() ?? null;
  const router = routerFor(event);
  const result = repo && router ? router({ payload, repo, index }) : null;
  return {
    repo,
    pullRequests: [...new Set(result?.pullRequests)],
    candidates: result?.candidates ?? [],
  };
}
