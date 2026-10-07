import { summarize } from "../core/summary.ts";
import type { Engine } from "./engine.ts";
import type { SourceStatus } from "../sources/types.ts";

export interface Health {
  ok: true;
  pid: number;
  startedAt: string;
  version: string;
  repos: string[];
  source: SourceStatus;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function pullRequestArgs(b: any) {
  if (typeof b?.repo !== "string" || !Number.isInteger(b?.number)) {
    throw new Error("body needs repo (owner/name) and number");
  }
  return { repo: b.repo as string, number: b.number as number };
}

export function controlHandler(engine: Engine, health: () => Health) {
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    try {
      if (req.method === "GET" && path === "/health") return json(health());
      if (req.method === "GET" && path === "/status") {
        return json({ prs: engine.status().map(summarize) });
      }
      if (req.method !== "POST") return json({ error: "not found" }, 404);
      const body: any = await req.json().catch(() => ({}));
      switch (path) {
        case "/track": {
          const { repo, number } = pullRequestArgs(body);
          const autoMerge = typeof body.autoMerge === "boolean" ? body.autoMerge : undefined;
          return json({
            key: engine.track(repo, number, { sessionId: body.sessionId ?? null, autoMerge }),
          });
        }
        case "/untrack": {
          const { repo, number } = pullRequestArgs(body);
          engine.untrack(repo, number);
          return json({ ok: true });
        }
        case "/auto-merge": {
          const { repo, number } = pullRequestArgs(body);
          if (body.enabled !== null && typeof body.enabled !== "boolean") {
            throw new Error("enabled must be true, false or null");
          }
          engine.setAutoMerge(repo, number, body.enabled);
          return json({ ok: true });
        }
        case "/review-requested": {
          const { repo, number } = pullRequestArgs(body);
          return json({ head: engine.markReviewRequested(repo, number, body.head) });
        }
        case "/resync": {
          void engine.resync("control api");
          return json({ ok: true });
        }
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  };
}
