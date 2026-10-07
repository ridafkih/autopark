import { describe, expect, test } from "bun:test";
import { ClockGapWakeDetector } from "../src/daemon/wake.ts";
import { GitHubHttp } from "../src/github/client.ts";
import { controlHandler } from "../src/daemon/control.ts";
import { FakeClock } from "./fixtures/clock.ts";
import { harness } from "./fixtures/harness.ts";
import { REPO, snap } from "./fixtures/build.ts";

describe("wake detector", () => {
  test.each([
    ["regular ticks never fire", [0, 0, 0], []],
    ["small drift is tolerated", [40_000], []],
    ["a sleep gap fires once with the time beyond the interval", [600_000, 0], [585_000]],
  ] as const)("%s", async (_l, jumps, expected) => {
    const clock = new FakeClock();
    const det = new ClockGapWakeDetector(clock, { intervalMs: 15_000, toleranceMs: 45_000 });
    const gaps: number[] = [];
    det.start((g) => gaps.push(g));
    for (const j of jumps) {
      clock.jump(j);
      await clock.advance(15_000);
    }
    det.stop();
    expect(gaps).toEqual([...expected]);
  });
});

function stubFetch(routes: Record<string, (body: any) => unknown>) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const f = async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init.method ?? "GET", body });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return new Response(JSON.stringify(routes[key]!(body)));
  };
  return { f, calls };
}

describe("GitHub HTTP client", () => {
  const prNode = {
    number: 7,
    state: "OPEN",
    headRefOid: "A".repeat(40),
    mergeable: "MERGEABLE",
    commits: { nodes: [] },
  };

  test("fetchPr sends owner, name and number and normalises the result", async () => {
    const { f, calls } = stubFetch({
      "/graphql": () => ({
        data: {
          rateLimit: { cost: 1 },
          repository: { nameWithOwner: "Acme/Widgets", pullRequest: prNode },
        },
      }),
    });
    const gh = new GitHubHttp({ token: async () => "t", fetch: f });
    const s = await gh.fetchPr("acme/widgets", 7);
    expect(calls[0]!.body.variables).toEqual({ owner: "acme", name: "widgets", n: 7 });
    expect(s).toMatchObject({ repo: "Acme/Widgets", number: 7, headSha: "a".repeat(40) });
    expect(gh.lastCost).toBe(1);
  });

  test("graphql errors throw", async () => {
    const { f } = stubFetch({ "/graphql": () => ({ errors: [{ message: "Could not resolve" }] }) });
    await expect(
      new GitHubHttp({ token: async () => "t", fetch: f }).fetchPr("a/b", 1),
    ).rejects.toThrow(/Could not resolve/);
  });

  test("compare reads behind count from ahead_by of head...base", async () => {
    const { f, calls } = stubFetch({
      "/compare/": () => ({ ahead_by: 3, files: [{ filename: "a.ts" }, { filename: "b/c.json" }] }),
    });
    const cmp = await new GitHubHttp({ token: async () => "t", fetch: f }).compare(
      "acme/widgets",
      "h",
      "b",
    );
    expect(calls[0]!.url).toContain("/repos/acme/widgets/compare/h...b");
    expect(cmp).toEqual({ behindBy: 3, files: ["a.ts", "b/c.json"], truncated: false });
  });

  test("search paginates and maps candidates", async () => {
    let page = 0;
    const { f } = stubFetch({
      "/graphql": () => {
        page++;
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
      },
    });
    const out = await new GitHubHttp({ token: async () => "t", fetch: f }).searchOpenPrs(
      "acme/widgets",
      "octo",
    );
    expect(out.map((c) => c.number)).toEqual([1, 2]);
  });

  test("merge pins the head sha", async () => {
    const { f, calls } = stubFetch({ "/merge": () => ({ merged: true }) });
    await new GitHubHttp({ token: async () => "t", fetch: f }).merge(
      "acme/widgets",
      7,
      "abc",
      "squash",
    );
    expect(calls[0]).toMatchObject({ method: "PUT", body: { sha: "abc", merge_method: "squash" } });
  });

  test("http errors include status and message", async () => {
    const { f } = stubFetch({});
    await expect(
      new GitHubHttp({ token: async () => "t", fetch: f }).merge("a/b", 1, "x", "merge"),
    ).rejects.toThrow(/404: Not Found/);
  });
});

describe("control api", () => {
  async function setup() {
    const h = await harness();
    h.github.set(snap());
    const health = () => ({
      ok: true as const,
      pid: 1,
      startedAt: "t",
      version: "v",
      repos: [REPO],
      source: { name: "replay", state: "connected" as const, detail: "" },
    });
    const call = (method: string, path: string, body?: unknown) =>
      controlHandler(
        h.engine,
        health,
      )(
        new Request(`http://localhost${path}`, {
          method,
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    return { h, call };
  }

  test("track, status, auto-merge, review-requested and untrack", async () => {
    const { h, call } = await setup();
    expect((await call("POST", "/track", { repo: REPO, number: 7, sessionId: "s1" })).status).toBe(
      200,
    );
    await h.engine.idle();
    const status: any = await (await call("GET", "/status")).json();
    expect(status.prs[0]).toMatchObject({ pr: `${REPO}#7`, state: "ready", sessionId: "s1" });
    expect(
      (await call("POST", "/auto-merge", { repo: REPO, number: 7, enabled: true })).status,
    ).toBe(200);
    expect(
      await (await call("POST", "/review-requested", { repo: REPO, number: 7 })).json(),
    ).toEqual({ head: snap().headSha });
    expect((await call("POST", "/untrack", { repo: REPO, number: 7 })).status).toBe(200);
    expect(((await (await call("GET", "/status")).json()) as any).prs).toEqual([]);
  });

  test.each([
    ["missing number", "/track", { repo: REPO }, 400],
    ["repo outside config", "/track", { repo: "x/y", number: 1 }, 400],
    [
      "auto-merge on an untracked PR",
      "/auto-merge",
      { repo: REPO, number: 99, enabled: true },
      400,
    ],
    ["bad enabled value", "/auto-merge", { repo: REPO, number: 7, enabled: "yes" }, 400],
    ["unknown route", "/explode", {}, 404],
  ])("%s", async (_l, path, body, status) => {
    const { call } = await setup();
    expect((await call("POST", path, body)).status).toBe(status);
  });

  test("health is served as given", async () => {
    const { call } = await setup();
    expect(await (await call("GET", "/health")).json()).toMatchObject({
      ok: true,
      source: { name: "replay" },
    });
  });
});
