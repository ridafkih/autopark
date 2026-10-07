import type { BaseComparison, Snapshot } from "../core/types.ts";
import type { Candidate } from "../core/track.ts";
import { PR_SNAPSHOT_QUERY, SEARCH_QUERY, VIEWER_QUERY } from "./query.ts";
import { normalizePr } from "./snapshot.ts";
import type { GitHub } from "./types.ts";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function resolveToken(): Promise<string> {
  const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (env) return env;
  const out = await Bun.$`gh auth token`.quiet().nothrow();
  const token = out.stdout.toString().trim();
  if (out.exitCode !== 0 || !token)
    throw new Error("no GitHub token: set GH_TOKEN or run `gh auth login`");
  return token;
}

const split = (repo: string) => {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`bad repo slug ${repo}`);
  return { owner, name };
};

export class GitHubHttp implements GitHub {
  private token: string | null = null;
  lastCost: number | null = null;

  constructor(
    private opts: { token?: () => Promise<string>; fetch?: FetchFn; apiUrl?: string } = {},
  ) {}

  private async auth() {
    if (!this.token) this.token = await (this.opts.token ?? resolveToken)();
    return this.token;
  }

  private async request(path: string, init: RequestInit = {}) {
    const f = this.opts.fetch ?? ((u, i) => fetch(u, i));
    const res = await f(`${this.opts.apiUrl ?? "https://api.github.com"}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.auth()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "pr-autopilot",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok)
      throw new Error(
        `GitHub ${init.method ?? "GET"} ${path} -> ${res.status}: ${json?.message ?? text}`,
      );
    return json;
  }

  async graphql(query: string, variables: Record<string, unknown>) {
    const json = await this.request("/graphql", {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    if (json?.errors?.length)
      throw new Error(`GraphQL: ${json.errors.map((e: any) => e.message).join("; ")}`);
    if (json?.data?.rateLimit) this.lastCost = json.data.rateLimit.cost;
    return json.data;
  }

  async viewer() {
    return (await this.graphql(VIEWER_QUERY, {})).viewer.login as string;
  }

  async fetchPr(repo: string, number: number): Promise<Snapshot> {
    const data = await this.graphql(PR_SNAPSHOT_QUERY, { ...split(repo), n: number });
    const pr = data?.repository?.pullRequest;
    if (!pr) throw new Error(`${repo}#${number} not found`);
    return normalizePr(data.repository.nameWithOwner ?? repo, pr);
  }

  async compare(repo: string, headSha: string, baseSha: string): Promise<BaseComparison> {
    const json = await this.request(`/repos/${repo}/compare/${headSha}...${baseSha}?per_page=1`);
    const files: string[] = (json.files ?? []).map((f: any) => f.filename);
    return { behindBy: json.ahead_by ?? 0, files, truncated: files.length >= 300 };
  }

  async searchOpenPrs(repo: string, author: string | null): Promise<Candidate[]> {
    const q = `repo:${repo} is:pr is:open${author ? ` author:${author}` : ""}`;
    const out: Candidate[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const data: any = await this.graphql(SEARCH_QUERY, { q, after });
      for (const n of data.search.nodes) {
        if (!n?.number) continue;
        out.push({
          repo: n.repository?.nameWithOwner ?? repo,
          number: n.number,
          author: n.author?.login ?? null,
          headRef: n.headRefName,
          baseRef: n.baseRefName,
          labels: (n.labels?.nodes ?? []).map((l: any) => l.name),
          open: true,
        });
      }
      if (!data.search.pageInfo.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
    return out;
  }

  async merge(repo: string, number: number, sha: string, method: "merge" | "squash" | "rebase") {
    await this.request(`/repos/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      body: JSON.stringify({ sha, merge_method: method }),
    });
  }
}
