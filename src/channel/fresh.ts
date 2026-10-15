import { resolve } from "node:path";
import { isRecord, isString, parseJson } from "../core/json.ts";
import type { Delivery, DeliveryRequest } from "./deliver.ts";

const ENTRY = resolve(import.meta.dir, "deliver.ts");

export type Deliver = (request: DeliveryRequest) => Promise<Delivery | null>;

function toDelivery(value: unknown): Delivery | null {
  if (!isRecord(value)) return null;
  if (value.format === "monitor" && isString(value.text)) {
    return { format: "monitor", text: value.text };
  }
  if (value.format === "channel" && isString(value.content) && isRecord(value.meta)) {
    const meta = Object.fromEntries(
      Object.entries(value.meta).filter((entry): entry is [string, string] => isString(entry[1])),
    );
    return { format: "channel", content: value.content, meta };
  }
  return null;
}

export const freshDelivery: Deliver = async (request) => {
  const subprocess = Bun.spawn([process.execPath, ENTRY], {
    cwd: request.cwd,
    env: process.env,
    stdin: new TextEncoder().encode(JSON.stringify(request)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (code !== 0) throw new Error(`delivery exited ${code}: ${stderr.trim()}`);
  return stdout.trim() ? toDelivery(parseJson(stdout)) : null;
};
