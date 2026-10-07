import type { Candidate } from "../core/track.ts";
import type { BaseComparison, Snapshot } from "../core/types.ts";
import type { GraphQLSearchNode, SearchData, SnapshotData } from "./graphql-types.ts";
import { PULL_REQUEST_SNAPSHOT_QUERY, SEARCH_QUERY, VIEWER_QUERY } from "./query.ts";
import { normalizePullRequest } from "./snapshot.ts";
import type { GitHub, MergeMethod } from "./types.ts";

type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

interface GitHubHttpOptions {
  token?: () => Promise<string>;
  fetch?: FetchFunction;
  apiUrl?: string;
}

interface GraphQLResponse<Data> {
  data: Data & { rateLimit?: { cost: number } | null };
  errors?: Array<{ message: string }>;
}

interface CompareResponse {
  ahead_by?: number;
  files?: Array<{ filename: string }>;
}

const DEFAULT_API_URL = "https://api.github.com";
const MAX_SEARCH_PAGES = 5;
const COMPARE_FILE_LIMIT = 300;

export async function resolveToken(): Promise<string> {
  const fromEnvironment = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnvironment) return fromEnvironment;
  const result = await Bun.$`gh auth token`.quiet().nothrow();
  const token = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !token) {
    throw new Error("no GitHub token: set GH_TOKEN or run `gh auth login`");
  }
  return token;
}

function splitRepo(repo: string) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`bad repo slug ${repo}`);
  return { owner, name };
}

const candidateFrom = (repo: string, node: GraphQLSearchNode & { number: number }): Candidate => ({
  repo: node.repository?.nameWithOwner ?? repo,
  number: node.number,
  author: node.author?.login ?? null,
  headRef: node.headRefName,
  baseRef: node.baseRefName,
  labels: (node.labels?.nodes ?? []).map((label) => label.name),
  open: true,
});

const hasNumber = (
  node: GraphQLSearchNode | null,
): node is GraphQLSearchNode & { number: number } => Boolean(node?.number);

export class GitHubHttp implements GitHub {
  lastCost: number | null = null;
  private token: string | null = null;

  constructor(private readonly options: GitHubHttpOptions = {}) {}

  async graphql<Data>(query: string, variables: Record<string, unknown>): Promise<Data> {
    const response = await this.request<GraphQLResponse<Data>>("/graphql", {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    if (response.errors?.length) {
      const messages = response.errors.map((error) => error.message).join("; ");
      throw new Error(`GraphQL: ${messages}`);
    }
    if (response.data.rateLimit) this.lastCost = response.data.rateLimit.cost;
    return response.data;
  }

  async viewer() {
    const data = await this.graphql<{ viewer: { login: string } }>(VIEWER_QUERY, {});
    return data.viewer.login;
  }

  async fetchPullRequest(repo: string, number: number): Promise<Snapshot> {
    const variables = { ...splitRepo(repo), number };
    const data = await this.graphql<SnapshotData>(PULL_REQUEST_SNAPSHOT_QUERY, variables);
    const pullRequest = data.repository?.pullRequest;
    if (!pullRequest) throw new Error(`${repo}#${number} not found`);
    return normalizePullRequest(data.repository?.nameWithOwner ?? repo, pullRequest);
  }

  async compare(repo: string, headSha: string, baseSha: string): Promise<BaseComparison> {
    const path = `/repos/${repo}/compare/${headSha}...${baseSha}?per_page=1`;
    const comparison = await this.request<CompareResponse>(path);
    const files = (comparison.files ?? []).map((file) => file.filename);
    return {
      behindBy: comparison.ahead_by ?? 0,
      files,
      truncated: files.length >= COMPARE_FILE_LIMIT,
    };
  }

  searchOpenPullRequests(repo: string, author: string | null): Promise<Candidate[]> {
    const authorFilter = author ? ` author:${author}` : "";
    return this.searchPages(repo, `repo:${repo} is:pr is:open${authorFilter}`, null, 0);
  }

  async merge(repo: string, number: number, sha: string, method: MergeMethod) {
    await this.request(`/repos/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      body: JSON.stringify({ sha, merge_method: method }),
    });
  }

  private async authorization() {
    if (!this.token) this.token = await (this.options.token ?? resolveToken)();
    return this.token;
  }

  private async request<Body>(path: string, init: RequestInit = {}): Promise<Body> {
    const send = this.options.fetch ?? ((url, requestInit) => fetch(url, requestInit));
    const response = await send(`${this.options.apiUrl ?? DEFAULT_API_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.authorization()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "pr-autopilot",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const method = init.method ?? "GET";
      const detail = json?.message ?? text;
      throw new Error(`GitHub ${method} ${path} -> ${response.status}: ${detail}`);
    }
    return json;
  }

  private async searchPages(
    repo: string,
    query: string,
    after: string | null,
    page: number,
  ): Promise<Candidate[]> {
    const data = await this.graphql<SearchData>(SEARCH_QUERY, { query, after });
    const candidates = data.search.nodes.filter(hasNumber).map((node) => candidateFrom(repo, node));
    const { hasNextPage, endCursor } = data.search.pageInfo;
    if (!hasNextPage || page + 1 >= MAX_SEARCH_PAGES) return candidates;
    return [...candidates, ...(await this.searchPages(repo, query, endCursor, page + 1))];
  }
}
