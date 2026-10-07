import { describe, expect, test } from "bun:test";
import { GitHubHttp } from "../src/github/client.ts";

type JsonBody = Record<string, unknown> | null;

interface RecordedCall {
  url: string;
  method: string;
  body: JsonBody;
}

interface SearchBody {
  variables: { after: string | null };
}

const NOT_FOUND = { message: "Not Found" };

function stubFetch(routes: Record<string, (body: JsonBody) => unknown>) {
  const calls: RecordedCall[] = [];
  const fetchStub = async (url: string, init: RequestInit) => {
    const body = init.body ? (JSON.parse(String(init.body)) as JsonBody) : null;
    calls.push({ url, method: init.method ?? "GET", body });
    const route = Object.entries(routes).find(([fragment]) => url.includes(fragment));
    if (!route) return new Response(JSON.stringify(NOT_FOUND), { status: 404 });
    const [, respond] = route;
    return new Response(JSON.stringify(respond(body)));
  };
  return { fetchStub, calls };
}

const clientFor = (fetchStub: (url: string, init: RequestInit) => Promise<Response>) =>
  new GitHubHttp({ token: async () => "token", fetch: fetchStub });

const searchPage = (body: JsonBody) => {
  const page = (body as SearchBody | null)?.variables.after === null ? 1 : 2;
  return {
    data: {
      search: {
        pageInfo: { hasNextPage: page === 1, endCursor: "c1" },
        nodes: [
          {
            number: page,
            headRefName: `h${page}`,
            baseRefName: "main",
            author: { login: "octo" },
            labels: { nodes: [] },
            repository: { nameWithOwner: "acme/widgets" },
          },
        ],
      },
    },
  };
};

describe("GitHub HTTP client", () => {
  const pullRequestNode = {
    number: 7,
    state: "OPEN",
    headRefOid: "A".repeat(40),
    mergeable: "MERGEABLE",
    commits: { nodes: [] },
  };

  test("fetchPullRequest sends owner, name and number and normalises the result", async () => {
    const { fetchStub, calls } = stubFetch({
      "/graphql": () => ({
        data: {
          rateLimit: { cost: 1 },
          repository: { nameWithOwner: "Acme/Widgets", pullRequest: pullRequestNode },
        },
      }),
    });
    const github = clientFor(fetchStub);
    const fetched = await github.fetchPullRequest("acme/widgets", 7);
    expect(calls[0]?.body?.variables).toEqual({ owner: "acme", name: "widgets", number: 7 });
    expect(fetched).toMatchObject({ repo: "Acme/Widgets", number: 7, headSha: "a".repeat(40) });
    expect(github.lastCost).toBe(1);
  });

  test("graphql errors throw", async () => {
    const { fetchStub } = stubFetch({
      "/graphql": () => ({ errors: [{ message: "Could not resolve" }] }),
    });
    await expect(clientFor(fetchStub).fetchPullRequest("a/b", 1)).rejects.toThrow(
      /Could not resolve/u,
    );
  });

  test("compare reads behind count from ahead_by of head...base", async () => {
    const { fetchStub, calls } = stubFetch({
      "/compare/": () => ({ ahead_by: 3, files: [{ filename: "a.ts" }, { filename: "b/c.json" }] }),
    });
    const comparison = await clientFor(fetchStub).compare("acme/widgets", "h", "b");
    expect(calls[0]?.url).toContain("/repos/acme/widgets/compare/h...b");
    expect(comparison).toEqual({ behindBy: 3, files: ["a.ts", "b/c.json"], truncated: false });
  });

  test("search paginates and maps candidates", async () => {
    const { fetchStub } = stubFetch({ "/graphql": searchPage });
    const candidates = await clientFor(fetchStub).searchOpenPullRequests("acme/widgets", "octo");
    expect(candidates.map((candidate) => candidate.number)).toEqual([1, 2]);
  });

  test("merge pins the head sha", async () => {
    const { fetchStub, calls } = stubFetch({ "/merge": () => ({ merged: true }) });
    await clientFor(fetchStub).merge("acme/widgets", 7, "abc", "squash");
    expect(calls[0]).toMatchObject({ method: "PUT", body: { sha: "abc", merge_method: "squash" } });
  });

  test("http errors include status and message", async () => {
    const { fetchStub } = stubFetch({});
    await expect(clientFor(fetchStub).merge("a/b", 1, "x", "merge")).rejects.toThrow(
      /404: Not Found/u,
    );
  });
});
