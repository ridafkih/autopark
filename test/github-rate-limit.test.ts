import { describe, expect, test } from "bun:test";
import { GitHubHttp } from "../src/github/client.ts";
import { RequestGate } from "../src/github/gate.ts";
import { PULL_REQUEST_SNAPSHOT_QUERY } from "../src/github/query.ts";
import { isRateLimitError } from "../src/github/rate-limit.ts";
import { FakeClock } from "./fixtures/clock.ts";

const SECONDARY =
  "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";
const MINUTE = 60_000;
const SPACING_MS = 1000;
const FETCH_MS = 10;

const OK_BODY = {
  data: {
    rateLimit: { cost: 1 },
    repository: {
      nameWithOwner: "acme/widgets",
      pullRequest: {
        number: 7,
        state: "OPEN",
        headRefOid: "a".repeat(40),
        mergeable: "MERGEABLE",
        commits: { nodes: [] },
      },
    },
  },
};

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function scripted(replies: Reply[]) {
  const clock = new FakeClock();
  const logs: string[] = [];
  const calls: number[] = [];
  const flight = { now: 0, max: 0 };
  const fetchStub = async () => {
    calls.push(clock.now());
    flight.now = flight.now + 1;
    flight.max = Math.max(flight.max, flight.now);
    await clock.sleep(FETCH_MS);
    flight.now = flight.now - 1;
    const reply = replies.shift() ?? {};
    return new Response(JSON.stringify(reply.body ?? OK_BODY), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  };
  const gate = new RequestGate({
    clock,
    graphqlSpacingMs: SPACING_MS,
    log: (message) => logs.push(message),
  });
  const github = new GitHubHttp({ token: async () => "token", fetch: fetchStub, gate });
  return { clock, logs, calls, flight, gate, github };
}

async function outcome(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return isRateLimitError(error) ? "rate_limited" : "error";
  }
}

async function settle(clock: FakeClock, promise: Promise<unknown>) {
  const result = outcome(promise);
  await clock.advance(FETCH_MS);
  return result;
}

describe("GitHub rate limits pause every call", () => {
  test("a secondary rate limit pauses all calls until retry-after, with one log line", async () => {
    const { clock, logs, calls, gate, github } = scripted([
      { status: 403, body: { message: SECONDARY }, headers: { "retry-after": "120" } },
    ]);
    expect(await settle(clock, github.fetchPullRequest("acme/widgets", 7))).toBe("rate_limited");
    const until = FETCH_MS + 2 * MINUTE;
    expect(gate.pause()).toEqual({ until, reason: "rate limited" });
    expect(await settle(clock, github.fetchPullRequest("acme/widgets", 8))).toBe("rate_limited");
    expect(await settle(clock, github.searchOpenPullRequests("acme/widgets", null))).toBe(
      "rate_limited",
    );
    expect(calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("pausing all GitHub calls until");
    await clock.advance(until - clock.now());
    expect(gate.pause()).toBeNull();
    expect(await settle(clock, github.fetchPullRequest("acme/widgets", 7))).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  test("an exhausted GraphQL quota pauses until x-ratelimit-reset", async () => {
    const { clock, gate, github } = scripted([
      {
        body: {
          errors: [
            { type: "RATE_LIMITED", message: "API rate limit already exceeded for user ID 1." },
          ],
        },
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "600" },
      },
    ]);
    expect(await settle(clock, github.fetchPullRequest("acme/widgets", 7))).toBe("rate_limited");
    expect(gate.pause()?.until).toBe(600_000);
  });

  test("a success that spends the last request pauses before the next call", async () => {
    const { clock, calls, gate, github } = scripted([
      { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "300" } },
    ]);
    expect(await settle(clock, github.fetchPullRequest("acme/widgets", 7))).toBe("ok");
    expect(gate.pause()?.until).toBe(300_000);
    expect(await settle(clock, github.fetchPullRequest("acme/widgets", 7))).toBe("rate_limited");
    expect(calls).toHaveLength(1);
  });

  test("without hints the pause starts at a minute and doubles until a call succeeds", async () => {
    const { clock, gate, github } = scripted([
      { status: 429 },
      { status: 429 },
      {},
      { status: 429 },
    ]);
    const pauses: number[] = [];
    const step = async () => {
      await clock.advance(SPACING_MS);
      await settle(clock, github.fetchPullRequest("acme/widgets", 7));
      const pause = gate.pause();
      pauses.push(pause ? pause.until - clock.now() : 0);
      if (pause) await clock.advance(pause.until - clock.now());
    };
    await step();
    await step();
    await step();
    await step();
    expect(pauses).toEqual([MINUTE, 2 * MINUTE, 0, MINUTE]);
  });

  test("requests run one at a time with GraphQL calls spaced apart", async () => {
    const { clock, calls, flight, github } = scripted([]);
    const all = Promise.all(
      [7, 8, 9].map((number) => github.fetchPullRequest("acme/widgets", number)),
    );
    await clock.advance(5 * SPACING_MS);
    await all;
    expect(flight.max).toBe(1);
    expect(calls).toEqual([0, SPACING_MS, 2 * SPACING_MS]);
  });
});

describe("snapshot query weight", () => {
  test("only GitHub Actions suites are read from the head commit, in smaller pages", () => {
    expect(PULL_REQUEST_SNAPSHOT_QUERY).toContain(
      "checkSuites(first: 30, filterBy: { appId: 15368 })",
    );
    expect(PULL_REQUEST_SNAPSHOT_QUERY).toContain(
      "checkRuns(first: 60, filterBy: { checkType: LATEST })",
    );
    expect(PULL_REQUEST_SNAPSHOT_QUERY).not.toContain("checkSuites(first: 50)");
  });
});
