import { timingSafeEqual } from "node:crypto";
import type { Delivery } from "./types.ts";

export function signature(secret: string, body: string) {
  const h = new Bun.CryptoHasher("sha256", secret);
  h.update(body);
  return `sha256=${h.digest("hex")}`;
}

export function verifySignature(secret: string, body: string, header: string | null) {
  if (!header) return false;
  const want = Buffer.from(signature(secret, body));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

function parseBody(body: string, contentType: string | null): unknown {
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    const payload = new URLSearchParams(body).get("payload");
    if (payload === null) throw new Error("form body without payload");
    return JSON.parse(payload);
  }
  return JSON.parse(body);
}

export interface ReceiverOptions {
  secret: string | null;
  path: string;
  deliver(d: Delivery): Promise<unknown> | unknown;
}

export function webhookHandler(opts: ReceiverOptions) {
  return async (req: Request): Promise<Response> => {
    if (new URL(req.url).pathname !== opts.path) return new Response("not found", { status: 404 });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await req.text();
    if (
      opts.secret &&
      !verifySignature(opts.secret, body, req.headers.get("x-hub-signature-256"))
    ) {
      return new Response("bad signature", { status: 401 });
    }
    const id = req.headers.get("x-github-delivery");
    const event = req.headers.get("x-github-event");
    if (!id || !event) return new Response("missing delivery headers", { status: 400 });
    let payload: unknown;
    try {
      payload = parseBody(body, req.headers.get("content-type"));
    } catch {
      return new Response("bad payload", { status: 400 });
    }
    try {
      await opts.deliver({ id, event, payload });
    } catch (e) {
      return new Response(`delivery failed: ${(e as Error).message}`, { status: 500 });
    }
    return new Response("accepted", { status: 202 });
  };
}

export function startReceiver(opts: ReceiverOptions & { hostname: string; port: number }) {
  return Bun.serve({ hostname: opts.hostname, port: opts.port, fetch: webhookHandler(opts) });
}
