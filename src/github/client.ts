import type { Candidate } from "../core/track.ts";
import type { BaseComparison, Snapshot } from "../core/types.ts";
import {
  arrayAt,
  isRecord,
  numberAt,
  parseJson,
  recordsAt,
  stringAt,
  valueAt,
  type JsonRecord,
} from "../core/json.ts";
import { PULL_REQUEST_SNAPSHOT_QUERY, SEARCH_QUERY, VIEWER_QUERY } from "./query.ts";
import { normalizePullRequest } from "./snapshot.ts";
import type { GitHub, MergeMethod } from "./types.ts";

type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

interface GitHubHttpOptions {
  token?: () => Promise<string>;
  fetch?: FetchFunction;
  apiUrl?: string;
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

const labelNames = (node: JsonRecord) =>
  recordsAt(node, "labels", "nodes").flatMap((label) => {
    const name = stringAt(label, "name");
    return name === undefined ? [] : [name];
  });

function candidateFrom(repo: string, node: JsonRecord): Candidate[] {
  const number = numberAt(node, "number");
  if (!number) return [];
  return [
    {
      repo: stringAt(node, "repository", "nameWithOwner") ?? repo,
      number,
      author: stringAt(node, "author", "login") ?? null,
      headRef: stringAt(node, "headRefName") ?? "",
      baseRef: stringAt(node, "baseRefName") ?? "",
      labels: labelNames(node),
      open: true,
    },
  ];
}

const fileNames = (comparison: unknown) =>
  recordsAt(comparison, "files").flatMap((file) => {
    const name = stringAt(file, "filename");
    return name === undefined ? [] : [name];
  });

export class GitHubHttp implements GitHub {
  lastCost: number | null = null;
  private token: string | null = null;

  constructor(private readonly options: GitHubHttpOptions = {}) {}

  async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const response = await this.request("/graphql", {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    const errors = arrayAt(response, "errors");
    if (errors.length > 0) {
      const messages = errors.map((error) => stringAt(error, "message") ?? "").join("; ");
      throw new Error(`GraphQL: ${messages}`);
    }
    const cost = numberAt(response, "data", "rateLimit", "cost");
    if (cost !== undefined) this.lastCost = cost;
    return valueAt(response, "data");
  }

  async viewer() {
    const data = await this.graphql(VIEWER_QUERY, {});
    const login = stringAt(data, "viewer", "login");
    if (login === undefined) throw new Error("GitHub did not return the viewer login");
    return login;
  }

  async fetchPullRequest(repo: string, number: number): Promise<Snapshot> {
    const variables = { ...splitRepo(repo), number };
    const data = await this.graphql(PULL_REQUEST_SNAPSHOT_QUERY, variables);
    const pullRequest = valueAt(data, "repository", "pullRequest");
    if (!isRecord(pullRequest)) throw new Error(`${repo}#${number} not found`);
    const owner = stringAt(data, "repository", "nameWithOwner") ?? repo;
    return normalizePullRequest(owner, pullRequest);
  }

  async compare(repo: string, headSha: string, baseSha: string): Promise<BaseComparison> {
    const path = `/repos/${repo}/compare/${headSha}...${baseSha}?per_page=1`;
    const comparison = await this.request(path);
    const files = fileNames(comparison);
    return {
      behindBy: numberAt(comparison, "ahead_by") ?? 0,
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

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const send = this.options.fetch ?? ((url, requestInit) => fetch(url, requestInit));
    const response = await send(`${this.options.apiUrl ?? DEFAULT_API_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.authorization()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "autopark",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    const json = text ? parseJson(text) : null;
    if (!response.ok) {
      const method = init.method ?? "GET";
      const detail = stringAt(json, "message") ?? text;
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
    const data = await this.graphql(SEARCH_QUERY, { query, after });
    const nodes = recordsAt(data, "search", "nodes");
    const candidates = nodes.flatMap((node) => candidateFrom(repo, node));
    const hasNextPage = Boolean(valueAt(data, "search", "pageInfo", "hasNextPage"));
    const endCursor = stringAt(data, "search", "pageInfo", "endCursor") ?? null;
    if (!hasNextPage || page + 1 >= MAX_SEARCH_PAGES) return candidates;
    return [...candidates, ...(await this.searchPages(repo, query, endCursor, page + 1))];
  }
}
