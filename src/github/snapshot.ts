import { pullRequestUrl } from "../core/format.ts";
import type {
  Approval,
  CheckContext,
  CheckOutcome,
  Mergeable,
  PullRequestComment,
  PullRequestState,
  ReviewThread,
  Snapshot,
} from "../core/types.ts";
import type {
  GraphQLCheckContext,
  GraphQLComment,
  GraphQLCommit,
  GraphQLPullRequest,
  GraphQLThread,
  GraphQLThreadComment,
} from "./graphql-types.ts";

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

const mergeableOf = (value: unknown): Mergeable =>
  value === "MERGEABLE" || value === "CONFLICTING" ? value : "UNKNOWN";

function normalizeCheck(context: GraphQLCheckContext): CheckContext {
  if (context.__typename === "StatusContext") {
    return {
      name: context.context,
      kind: "status",
      outcome: statusOutcome(context.state),
      conclusion: context.state,
      isRequired: Boolean(context.isRequired),
      app: null,
      url: context.targetUrl ?? null,
    };
  }
  return {
    name: context.name,
    kind: "check",
    outcome: checkRunOutcome(context.status, context.conclusion ?? null),
    conclusion: context.conclusion ?? context.status,
    isRequired: Boolean(context.isRequired),
    app: context.checkSuite?.app?.slug ?? null,
    url: context.detailsUrl ?? null,
  };
}

const normalizeComment = (comment: GraphQLComment): PullRequestComment => ({
  id: String(comment.id ?? comment.databaseId),
  author: comment.author?.login ?? null,
  body: comment.body ?? "",
  updatedAt: comment.updatedAt ?? "",
});

function uniqueComments(node: GraphQLPullRequest) {
  const comments = [
    ...(node.firstComments?.nodes ?? []),
    ...(node.lastComments?.nodes ?? []),
    ...(node.comments?.nodes ?? []),
  ].map(normalizeComment);
  return comments.filter(
    (comment, index) => comments.findIndex((other) => other.id === comment.id) === index,
  );
}

const approvalsOf = (node: GraphQLPullRequest): Approval[] =>
  (node.latestOpinionatedReviews?.nodes ?? []).map((review) => ({
    login: review.author?.login ?? "ghost",
    state: review.state,
    sha: review.commit?.oid?.toLowerCase() ?? null,
  }));

const firstCommentDetails = (path: string | null | undefined, comment?: GraphQLThreadComment) => ({
  author: comment?.author?.login ?? null,
  path: path ?? comment?.path ?? null,
  url: comment?.url ?? null,
});

const normalizeThread = (thread: GraphQLThread): ReviewThread => ({
  id: thread.id,
  resolved: Boolean(thread.isResolved),
  outdated: Boolean(thread.isOutdated),
  ...firstCommentDetails(thread.path, thread.comments?.nodes?.[0]),
});

function stateOf(node: GraphQLPullRequest): PullRequestState {
  if (node.state === "MERGED" || node.merged) return "MERGED";
  return node.state === "CLOSED" ? "CLOSED" : "OPEN";
}

const refsOf = (node: GraphQLPullRequest, commit: GraphQLCommit | undefined) => ({
  headRef: node.headRefName ?? "",
  baseRef: node.baseRefName ?? "",
  headSha: (node.headRefOid ?? commit?.oid ?? "").toLowerCase(),
  baseSha: node.baseRef?.target?.oid?.toLowerCase() ?? null,
});

const descriptionOf = (repo: string, node: GraphQLPullRequest) => ({
  title: node.title ?? "",
  url: node.url ?? pullRequestUrl({ repo, number: node.number }),
  state: stateOf(node),
  isDraft: Boolean(node.isDraft),
  author: node.author?.login ?? null,
});

const latestCommit = (node: GraphQLPullRequest) => node.commits?.nodes?.[0]?.commit ?? undefined;

const checksOf = (commit: GraphQLCommit | undefined) =>
  (commit?.statusCheckRollup?.contexts?.nodes ?? []).map(normalizeCheck);

const labelsOf = (node: GraphQLPullRequest) =>
  (node.labels?.nodes ?? []).map((label) => label.name);

export function normalizePullRequest(repo: string, node: GraphQLPullRequest): Snapshot {
  const commit = latestCommit(node);
  return {
    repo,
    number: node.number,
    ...descriptionOf(repo, node),
    ...refsOf(node, commit),
    baseComparison: null,
    labels: labelsOf(node),
    mergeable: mergeableOf(node.mergeable),
    mergeStateStatus: node.mergeStateStatus ?? "UNKNOWN",
    checks: checksOf(commit),
    approvals: approvalsOf(node),
    threads: (node.reviewThreads?.nodes ?? []).map(normalizeThread),
    comments: uniqueComments(node),
  };
}
