import { describe, expect, test } from "bun:test";
import { signature, verifySignature, webhookHandler } from "../src/sources/receiver.ts";
import type { Delivery } from "../src/sources/types.ts";

const SECRET = "s3cret";
const BODY = JSON.stringify({ zen: "hi", repository: { full_name: "acme/widgets" } });
const FORM_BODY = `payload=${encodeURIComponent(BODY)}`;
const DOCUMENTED_SIGNATURE =
  "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

interface RequestOptions {
  method?: string;
  path?: string;
  signatureHeader?: string | null;
  id?: string | null;
  event?: string | null;
  body?: string;
  type?: string;
}

const optionalHeader = (name: string, value: string | null): Record<string, string> =>
  value === null ? {} : { [name]: value };

function webhookHeaders(options: RequestOptions, payload: string) {
  const signatureHeader =
    options.signatureHeader === undefined ? signature(SECRET, payload) : options.signatureHeader;
  return {
    "content-type": options.type ?? "application/json",
    ...optionalHeader("x-hub-signature-256", signatureHeader),
    ...optionalHeader("x-github-delivery", options.id === undefined ? "d1" : options.id),
    ...optionalHeader("x-github-event", options.event === undefined ? "ping" : options.event),
  };
}

function webhookRequest(options: RequestOptions) {
  const payload = options.body ?? BODY;
  const path = options.path ?? "/github";
  return new Request(`http://127.0.0.1${path}`, {
    method: options.method ?? "POST",
    headers: webhookHeaders(options, payload),
    body: options.method === "GET" ? undefined : payload,
  });
}

describe("webhook receiver", () => {
  test.each([
    ["valid signature", {}, SECRET, 202],
    ["wrong signature", { signatureHeader: "sha256=deadbeef" }, SECRET, 401],
    ["missing signature", { signatureHeader: null }, SECRET, 401],
    ["signature over a different body", { signatureHeader: signature(SECRET, "{}") }, SECRET, 401],
    ["no secret configured accepts unsigned", { signatureHeader: null }, null, 202],
    ["missing delivery id", { id: null }, SECRET, 400],
    ["missing event header", { event: null }, SECRET, 400],
    ["invalid json", { body: "{nope", signatureHeader: signature(SECRET, "{nope") }, SECRET, 400],
    [
      "form encoded payload",
      {
        body: FORM_BODY,
        type: "application/x-www-form-urlencoded",
        signatureHeader: signature(SECRET, FORM_BODY),
      },
      SECRET,
      202,
    ],
    ["wrong path", { path: "/other" }, SECRET, 404],
    ["wrong method", { method: "GET" }, SECRET, 405],
  ] as const)("%s", async (label, options, secret, status) => {
    const received: Delivery[] = [];
    const deliver = (delivery: Delivery) => received.push(delivery);
    const response = await webhookHandler({ secret, path: "/github", deliver })(
      webhookRequest(options),
    );
    expect(response.status).toBe(status);
    expect(received.length).toBe(status === 202 ? 1 : 0);
    if (status === 202) {
      expect(received[0]).toMatchObject({ id: "d1", event: "ping", payload: { zen: "hi" } });
    }
  });

  test("delivery errors surface as 500 so the sender can retry", async () => {
    const response = await webhookHandler({
      secret: null,
      path: "/github",
      deliver: () => {
        throw new Error("db locked");
      },
    })(webhookRequest({ signatureHeader: null }));
    expect(response.status).toBe(500);
  });

  test("signature helper matches GitHub's documented example", () => {
    expect(signature("It's a Secret to Everybody", "Hello, World!")).toBe(DOCUMENTED_SIGNATURE);
    expect(
      verifySignature("It's a Secret to Everybody", "Hello, World!", DOCUMENTED_SIGNATURE),
    ).toBe(true);
  });
});
