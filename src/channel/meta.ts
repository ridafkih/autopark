import type { LoggedTransition } from "../core/types.ts";

const safeKey = (k: string) =>
  k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/[^A-Za-z0-9_]/g, "_");

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v))
    return v
      .map((x) => (typeof x === "object" && x && "code" in x ? String((x as any).code) : String(x)))
      .join(",");
  if (typeof v === "object") return null;
  return String(v);
}

const RENAMES: Record<string, string> = {
  names: "failed",
  required: "required_failed",
  head: "reviewed_head",
};
const SKIP = new Set(["checks", "previous", "reviewsCount", "lastKnown"]);

export function channelMeta(t: LoggedTransition): Record<string, string> {
  const meta: Record<string, string> = {
    kind: t.kind,
    repo: t.repo,
    pr: String(t.number),
    head: t.head ?? "",
    transition_id: String(t.id),
    url: t.url,
  };
  for (const [k, v] of Object.entries(t.data)) {
    if (SKIP.has(k)) continue;
    const value = str(v);
    if (value === null) continue;
    const key = RENAMES[k] ?? safeKey(k);
    if (!(key in meta)) meta[key] = value;
  }
  return meta;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

export function channelContent(t: LoggedTransition) {
  return `${t.repo}#${t.number} ${t.kind}: ${oneLine(t.reason)}${t.title ? ` (${t.title})` : ""} ${t.url}`;
}

export function monitorLine(t: LoggedTransition) {
  return `pr-autopilot ${t.repo}#${t.number} ${t.kind} head=${(t.head ?? "").slice(0, 7)}: ${oneLine(t.reason)} ${t.url}`;
}
