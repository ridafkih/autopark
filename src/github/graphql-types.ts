interface Nodes<Node> {
  nodes?: Node[] | null;
}

interface Actor {
  login?: string | null;
}

export interface GraphQLCheckRun {
  __typename: "CheckRun";
  name: string;
  status: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
  isRequired?: boolean | null;
  checkSuite?: { app?: { slug?: string | null } | null } | null;
}

export interface GraphQLStatusContext {
  __typename: "StatusContext";
  context: string;
  state: string;
  targetUrl?: string | null;
  isRequired?: boolean | null;
}

export type GraphQLCheckContext = GraphQLCheckRun | GraphQLStatusContext;

export interface GraphQLComment {
  id?: string | null;
  databaseId?: number | null;
  author?: Actor | null;
  body?: string | null;
  updatedAt?: string | null;
}

interface GraphQLReview {
  author?: Actor | null;
  state: string;
  commit?: { oid?: string | null } | null;
}

export interface GraphQLThreadComment {
  author?: Actor | null;
  path?: string | null;
  url?: string | null;
}

export interface GraphQLThread {
  id: string;
  isResolved?: boolean | null;
  isOutdated?: boolean | null;
  path?: string | null;
  comments?: Nodes<GraphQLThreadComment>;
}

export interface GraphQLCommit {
  oid?: string | null;
  statusCheckRollup?: { state?: string | null; contexts?: Nodes<GraphQLCheckContext> } | null;
}

export interface GraphQLPullRequest {
  number: number;
  title?: string | null;
  url?: string | null;
  state?: string | null;
  merged?: boolean | null;
  isDraft?: boolean | null;
  author?: Actor | null;
  headRefName?: string | null;
  baseRefName?: string | null;
  headRefOid?: string | null;
  baseRef?: { target?: { oid?: string | null } | null } | null;
  labels?: Nodes<{ name: string }>;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  latestOpinionatedReviews?: Nodes<GraphQLReview>;
  reviewThreads?: Nodes<GraphQLThread>;
  firstComments?: Nodes<GraphQLComment>;
  lastComments?: Nodes<GraphQLComment>;
  comments?: Nodes<GraphQLComment>;
  commits?: Nodes<{ commit?: GraphQLCommit | null }>;
}

export interface GraphQLSearchNode {
  number?: number;
  headRefName: string;
  baseRefName: string;
  author?: Actor | null;
  labels?: Nodes<{ name: string }>;
  repository?: { nameWithOwner?: string | null } | null;
}

export interface SnapshotData {
  repository?: { nameWithOwner?: string | null; pullRequest?: GraphQLPullRequest | null } | null;
}

export interface SearchData {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<GraphQLSearchNode | null>;
  };
}
