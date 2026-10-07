import { pullRequestUrl } from "../core/format.ts";
import { numberAt, recordsAt, stringAt, valueAt, type JsonRecord } from "../core/json.ts";
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

const loginAt = (value: unknown, ...keys: string[]) => stringAt(value, ...keys, "login") ?? null;

const lowerShaAt = (value: unknown, ...keys: string[]) =>
  stringAt(value, ...keys)?.toLowerCase() ?? null;

function normalizeStatus(context: JsonRecord): CheckContext {
  const state = stringAt(context, "state") ?? "";
  return {
    name: stringAt(context, "context") ?? "",
    kind: "status",
    outcome: statusOutcome(state),
    conclusion: state,
    isRequired: Boolean(context.isRequired),
    app: null,
    url: stringAt(context, "targetUrl") ?? null,
  };
}

function normalizeCheck(context: JsonRecord): CheckContext {
  if (context.__typename === "StatusContext") return normalizeStatus(context);
  const status = stringAt(context, "status") ?? "";
  const conclusion = stringAt(context, "conclusion") ?? null;
  return {
    name: stringAt(context, "name") ?? "",
    kind: "check",
    outcome: checkRunOutcome(status, conclusion),
    conclusion: conclusion ?? status,
    isRequired: Boolean(context.isRequired),
    app: stringAt(context, "checkSuite", "app", "slug") ?? null,
    url: stringAt(context, "detailsUrl") ?? null,
  };
}

const normalizeComment = (comment: JsonRecord): PullRequestComment => ({
  id: String(comment.id ?? comment.databaseId),
  author: loginAt(comment, "author"),
  body: stringAt(comment, "body") ?? "",
  updatedAt: stringAt(comment, "updatedAt") ?? "",
});

function uniqueComments(node: JsonRecord) {
  const comments = ["firstComments", "lastComments", "comments"]
    .flatMap((connection) => recordsAt(node, connection, "nodes"))
    .map(normalizeComment);
  return comments.filter(
    (comment, index) => comments.findIndex((other) => other.id === comment.id) === index,
  );
}

const approvalsOf = (node: JsonRecord): Approval[] =>
  recordsAt(node, "latestOpinionatedReviews", "nodes").map((review) => ({
    login: loginAt(review, "author") ?? "ghost",
    state: stringAt(review, "state") ?? "",
    sha: lowerShaAt(review, "commit", "oid"),
  }));

function normalizeThread(thread: JsonRecord): ReviewThread {
  const [firstComment] = recordsAt(thread, "comments", "nodes");
  return {
    id: stringAt(thread, "id") ?? "",
    resolved: Boolean(thread.isResolved),
    outdated: Boolean(thread.isOutdated),
    author: loginAt(firstComment, "author"),
    path: stringAt(thread, "path") ?? stringAt(firstComment, "path") ?? null,
    url: stringAt(firstComment, "url") ?? null,
  };
}

function stateOf(node: JsonRecord): PullRequestState {
  if (node.state === "MERGED" || node.merged) return "MERGED";
  return node.state === "CLOSED" ? "CLOSED" : "OPEN";
}

const refsOf = (node: JsonRecord, commit: unknown) => ({
  headRef: stringAt(node, "headRefName") ?? "",
  baseRef: stringAt(node, "baseRefName") ?? "",
  headSha: (stringAt(node, "headRefOid") ?? stringAt(commit, "oid") ?? "").toLowerCase(),
  baseSha: lowerShaAt(node, "baseRef", "target", "oid"),
});

const descriptionOf = (repo: string, node: JsonRecord, number: number) => ({
  title: stringAt(node, "title") ?? "",
  url: stringAt(node, "url") ?? pullRequestUrl({ repo, number }),
  state: stateOf(node),
  isDraft: Boolean(node.isDraft),
  author: loginAt(node, "author"),
});

const labelsOf = (node: JsonRecord) =>
  recordsAt(node, "labels", "nodes").flatMap((label) => {
    const name = stringAt(label, "name");
    return name === undefined ? [] : [name];
  });

export function normalizePullRequest(repo: string, node: JsonRecord): Snapshot {
  const number = numberAt(node, "number");
  if (number === undefined) throw new Error(`pull request node for ${repo} has no number`);
  const [latest] = recordsAt(node, "commits", "nodes");
  const commit = valueAt(latest, "commit");
  return {
    repo,
    number,
    ...descriptionOf(repo, node, number),
    ...refsOf(node, commit),
    baseComparison: null,
    labels: labelsOf(node),
    mergeable: mergeableOf(node.mergeable),
    mergeStateStatus: stringAt(node, "mergeStateStatus") ?? "UNKNOWN",
    checks: recordsAt(commit, "statusCheckRollup", "contexts", "nodes").map(normalizeCheck),
    approvals: approvalsOf(node),
    threads: recordsAt(node, "reviewThreads", "nodes").map(normalizeThread),
    comments: uniqueComments(node),
  };
}
