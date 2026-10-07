import { errorMessage } from "../core/errors.ts";
import { summarize } from "../core/summary.ts";
import type { PullRequestLocator } from "../core/types.ts";
import type { SourceStatus } from "../sources/types.ts";
import type { Engine } from "./engine.ts";

export interface Health {
  ok: true;
  pid: number;
  startedAt: string;
  version: string;
  repos: string[];
  source: SourceStatus;
}

type ControlBody = Record<string, unknown>;
type PostHandler = (engine: Engine, body: ControlBody) => unknown;

const NOT_FOUND = { error: "not found" };

const json = (body: unknown, status = 200) => Response.json(body, { status });

const isRecord = (value: unknown): value is ControlBody =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function pullRequestArgs(body: ControlBody): PullRequestLocator {
  const { repo, number } = body;
  if (typeof repo !== "string" || typeof number !== "number" || !Number.isInteger(number)) {
    throw new TypeError("body needs repo (owner/name) and number");
  }
  return { repo, number };
}

async function readBody(request: Request): Promise<ControlBody> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function readEnabled(body: ControlBody) {
  const { enabled } = body;
  if (enabled !== null && typeof enabled !== "boolean") {
    throw new TypeError("enabled must be true, false or null");
  }
  return enabled;
}

const POST_ROUTES = new Map<string, PostHandler>([
  [
    "/track",
    (engine, body) => {
      const { repo, number } = pullRequestArgs(body);
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
      const autoMerge = typeof body.autoMerge === "boolean" ? body.autoMerge : undefined;
      return { key: engine.track(repo, number, { sessionId, autoMerge }) };
    },
  ],
  [
    "/untrack",
    (engine, body) => {
      const { repo, number } = pullRequestArgs(body);
      engine.untrack(repo, number);
      return { ok: true };
    },
  ],
  [
    "/auto-merge",
    (engine, body) => {
      const { repo, number } = pullRequestArgs(body);
      engine.setAutoMerge(repo, number, readEnabled(body));
      return { ok: true };
    },
  ],
  [
    "/review-requested",
    (engine, body) => {
      const { repo, number } = pullRequestArgs(body);
      const head = typeof body.head === "string" ? body.head : undefined;
      return { head: engine.markReviewRequested(repo, number, head) };
    },
  ],
  [
    "/resync",
    (engine) => {
      void engine.resync("control api");
      return { ok: true };
    },
  ],
]);

async function respond(engine: Engine, health: () => Health, request: Request) {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/health") return json(health());
  if (request.method === "GET" && path === "/status") {
    return json({ prs: engine.status().map(summarize) });
  }
  const handler = request.method === "POST" ? POST_ROUTES.get(path) : undefined;
  if (!handler) return json(NOT_FOUND, 404);
  return json(handler(engine, await readBody(request)));
}

export function controlHandler(engine: Engine, health: () => Health) {
  return async (request: Request): Promise<Response> => {
    try {
      return await respond(engine, health, request);
    } catch (error) {
      return json({ error: errorMessage(error) }, 400);
    }
  };
}
