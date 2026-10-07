import { describe, expect, test } from "bun:test";
import { controlHandler, type Health } from "../src/daemon/control.ts";
import { REPO, snapshot } from "./fixtures/build.ts";
import { createHarness } from "./fixtures/harness.ts";
import { arrayAt } from "../src/core/json.ts";

const health = (): Health => ({
  ok: true,
  pid: 1,
  startedAt: "t",
  version: "v",
  repos: [REPO],
  source: { name: "replay", state: "connected", detail: "" },
});

async function createControl() {
  const harness = await createHarness();
  harness.github.set(snapshot());
  const handle = controlHandler(harness.engine, health);
  const call = (method: string, path: string, body?: unknown) =>
    handle(
      new Request(`http://localhost${path}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const readJson = async (method: string, path: string, body?: unknown) => {
    const response = await call(method, path, body);
    const json: unknown = await response.json();
    return json;
  };
  return { harness, call, readJson };
}

describe("control api", () => {
  test("track, status, auto-merge, review-requested and untrack", async () => {
    const { harness, call, readJson } = await createControl();
    const tracked = await call("POST", "/track", { repo: REPO, number: 7, sessionId: "s1" });
    expect(tracked.status).toBe(200);
    await harness.engine.idle();
    const status = await readJson("GET", "/status");
    expect(arrayAt(status, "prs")[0]).toMatchObject({
      pr: `${REPO}#7`,
      state: "ready",
      sessionId: "s1",
    });
    const autoMerged = await call("POST", "/auto-merge", { repo: REPO, number: 7, enabled: true });
    expect(autoMerged.status).toBe(200);
    expect(await readJson("POST", "/review-requested", { repo: REPO, number: 7 })).toEqual({
      head: snapshot().headSha,
    });
    const untracked = await call("POST", "/untrack", { repo: REPO, number: 7 });
    expect(untracked.status).toBe(200);
    const after = await readJson("GET", "/status");
    expect(arrayAt(after, "prs")).toEqual([]);
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
  ])("%s", async (label, path, body, status) => {
    const { call } = await createControl();
    const response = await call("POST", path, body);
    expect(response.status).toBe(status);
  });

  test("health is served as given", async () => {
    const { readJson } = await createControl();
    expect(await readJson("GET", "/health")).toMatchObject({
      ok: true,
      source: { name: "replay" },
    });
  });
});
