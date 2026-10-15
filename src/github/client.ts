import type { Candidate } from "../core/track.ts";
import type { Snapshot } from "../core/types.ts";
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
import { systemClock } from "../daemon/clock.ts";
import { RequestGate } from "./gate.ts";
import { PULL_REQUEST_SNAPSHOT_QUERY, SEARCH_QUERY, VIEWER_QUERY } from "./query.ts";
import {
  hintFrom,
  isExhausted,
  isRateLimitedGraphqlError,
  isRateLimitedResponse,
} from "./rate-limit.ts";
import { normalizePullRequest } from "./snapshot.ts";
import type { GitHub, MergeMethod } from "./types.ts";

type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

interface GitHubHttpOptions {
  token?: () => Promise<string>;
  fetch?: FetchFunction;
  apiUrl?: string;
  gate?: RequestGate;
}

interface GitHubRequestInit extends RequestInit {
  apiVersion?: string;
}

const DEFAULT_API_URL = "https://api.github.com";
const STACK_MERGE_API_VERSION = "2026-03-10";
const MAX_SEARCH_PAGES = 5;
const REQUEST_TIMEOUT_MS = 60_000;
const GRAPHQL_PATH = "/graphql";

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

export class GitHubHttp implements GitHub {
  lastCost: number | null = null;
  private token: string | null = null;
  private readonly gate: RequestGate;

  constructor(private readonly options: GitHubHttpOptions = {}) {
    this.gate = options.gate ?? new RequestGate({ clock: systemClock });
  }

  pause() {
    return this.gate.pause();
  }

  async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const response = await this.request(GRAPHQL_PATH, {
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

  searchOpenPullRequests(repo: string, author: string | null): Promise<Candidate[]> {
    const authorFilter = author ? ` author:${author}` : "";
    return this.searchPages(repo, `repo:${repo} is:pr is:open${authorFilter}`, null, 0);
  }

  async merge(repo: string, number: number, sha: string, method: MergeMethod) {
    const pullRequest = await this.request(`/repos/${repo}/pulls/${number}`);
    if (isRecord(valueAt(pullRequest, "stack"))) {
      await this.request(`/repos/${repo}/pulls/${number}/merge-async`, {
        method: "PUT",
        body: JSON.stringify({ sha, merge_method: method, merge_action: "direct_merge" }),
        apiVersion: STACK_MERGE_API_VERSION,
      });
      return;
    }
    await this.request(`/repos/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      body: JSON.stringify({ sha, merge_method: method }),
    });
  }

  private async authorization() {
    if (!this.token) this.token = await (this.options.token ?? resolveToken)();
    return this.token;
  }

  private request(path: string, options: GitHubRequestInit = {}): Promise<unknown> {
    const kind = path === GRAPHQL_PATH ? "graphql" : "rest";
    return this.gate.run(kind, () => this.send(path, options));
  }

  private async send(path: string, options: GitHubRequestInit): Promise<unknown> {
    const { apiVersion, ...init } = options;
    const send = this.options.fetch ?? ((url, requestInit) => fetch(url, requestInit));
    const response = await send(`${this.options.apiUrl ?? DEFAULT_API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${await this.authorization()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": apiVersion ?? "2022-11-28",
        "user-agent": "autopark",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    const json = text ? parseJson(text) : null;
    const failure = `GitHub ${init.method ?? "GET"} ${path} -> ${response.status}`;
    const detail = stringAt(json, "message") ?? text;
    this.watchRateLimit(response, json, `${failure}: ${detail}`);
    if (!response.ok) throw new Error(`${failure}: ${detail}`);
    return json;
  }

  private watchRateLimit(response: Response, json: unknown, failure: string) {
    const hint = hintFrom(response.headers);
    if (isRateLimitedResponse(response, failure)) throw this.gate.limit(hint, failure);
    const limited = arrayAt(json, "errors").filter(isRateLimitedGraphqlError);
    if (limited.length > 0) {
      const messages = limited.map((error) => stringAt(error, "message") ?? "").join("; ");
      throw this.gate.limit(hint, `GraphQL: ${messages}`);
    }
    if (isExhausted(response.headers)) this.gate.limit(hint, "the rate limit quota is spent");
    else this.gate.succeeded();
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
