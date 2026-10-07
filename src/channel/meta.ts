import { formatPullRequest, shortSha } from "../core/format.ts";
import type { LoggedTransition } from "../core/types.ts";

const RENAMES: Record<string, string> = {
  names: "failed",
  required: "required_failed",
  head: "reviewed_head",
};
const SKIP = new Set(["checks", "previous", "reviewsCount", "lastKnown"]);

const safeKey = (key: string) =>
  key
    .replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)
    .replaceAll(/[^A-Za-z0-9_]/gu, "_");

const hasCode = (value: unknown): value is { code: unknown } =>
  typeof value === "object" && value !== null && "code" in value;

const listEntry = (value: unknown) => (hasCode(value) ? String(value.code) : String(value));

function metaValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(listEntry).join(",");
  if (typeof value === "object") return null;
  return String(value);
}

function dataEntries(data: Record<string, unknown>) {
  return Object.entries(data)
    .filter(([key]) => !SKIP.has(key))
    .flatMap(([key, value]) => {
      const text = metaValue(value);
      return text === null ? [] : [[RENAMES[key] ?? safeKey(key), text] as const];
    });
}

export function channelMeta(transition: LoggedTransition): Record<string, string> {
  const base: Record<string, string> = {
    kind: transition.kind,
    repo: transition.repo,
    pr: String(transition.number),
    head: transition.head ?? "",
    transition_id: String(transition.id),
    url: transition.url,
  };
  const entries = dataEntries(transition.data);
  const extras = entries.filter(
    ([key], index) => !(key in base) && entries.findIndex(([other]) => other === key) === index,
  );
  return { ...base, ...Object.fromEntries(extras) };
}

const oneLine = (text: string) => text.replaceAll(/\s*\n\s*/gu, " ").trim();

export function channelContent(transition: LoggedTransition) {
  const title = transition.title ? ` (${transition.title})` : "";
  const reason = oneLine(transition.reason);
  return `${formatPullRequest(transition)} ${transition.kind}: ${reason}${title} ${transition.url}`;
}

export function monitorLine(transition: LoggedTransition) {
  const head = shortSha(transition.head ?? "");
  const reason = oneLine(transition.reason);
  const label = formatPullRequest(transition);
  return `pr-autopilot ${label} ${transition.kind} head=${head}: ${reason} ${transition.url}`;
}
