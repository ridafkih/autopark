import { timingSafeEqual } from "node:crypto";
import { errorMessage } from "../core/errors.ts";
import type { Delivery } from "./types.ts";

export interface ReceiverOptions {
  secret: string | null;
  path: string;
  deliver(delivery: Delivery): Promise<unknown> | unknown;
}

type ParsedPayload = { ok: true; payload: unknown } | { ok: false };

const textResponse = (body: string, status: number) => new Response(body, { status });

export function signature(secret: string, body: string) {
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(body);
  return `sha256=${hasher.digest("hex")}`;
}

export function verifySignature(secret: string, body: string, header: string | null) {
  if (!header) return false;
  const expected = Buffer.from(signature(secret, body));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function parseBody(body: string, contentType: string | null): unknown {
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    const payload = new URLSearchParams(body).get("payload");
    if (payload === null) throw new Error("form body without payload");
    return JSON.parse(payload);
  }
  return JSON.parse(body);
}

function parsePayload(body: string, contentType: string | null): ParsedPayload {
  try {
    return { ok: true, payload: parseBody(body, contentType) };
  } catch {
    return { ok: false };
  }
}

const isAuthentic = (secret: string | null, body: string, request: Request) =>
  !secret || verifySignature(secret, body, request.headers.get("x-hub-signature-256"));

async function deliver(options: ReceiverOptions, delivery: Delivery) {
  try {
    await options.deliver(delivery);
  } catch (error) {
    return textResponse(`delivery failed: ${errorMessage(error)}`, 500);
  }
  return textResponse("accepted", 202);
}

export function webhookHandler(options: ReceiverOptions) {
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== options.path) return textResponse("not found", 404);
    if (request.method !== "POST") return textResponse("method not allowed", 405);
    const body = await request.text();
    if (!isAuthentic(options.secret, body, request)) return textResponse("bad signature", 401);
    const id = request.headers.get("x-github-delivery");
    const event = request.headers.get("x-github-event");
    if (!id || !event) return textResponse("missing delivery headers", 400);
    const parsed = parsePayload(body, request.headers.get("content-type"));
    if (!parsed.ok) return textResponse("bad payload", 400);
    return deliver(options, { id, event, payload: parsed.payload });
  };
}

export function startReceiver(options: ReceiverOptions & { hostname: string; port: number }) {
  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    fetch: webhookHandler(options),
  });
}
