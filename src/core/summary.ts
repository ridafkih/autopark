import type { PrRecord } from "../daemon/store.ts";
import type { Reason } from "./types.ts";

export interface PrSummary {
  pr: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  head: string | null;
  state: string;
  ready: boolean;
  mergeableNow: boolean;
  awaitingHuman: boolean;
  reasons: Reason[];
  autoMerge: boolean | null;
  sessionId: string | null;
  reviewRequestedHead: string | null;
  updatedAt: number;
}

export function summarize(r: PrRecord): PrSummary {
  const e = r.evaluation;
  return {
    pr: `${r.repo}#${r.number}`,
    repo: r.repo,
    number: r.number,
    title: e?.title ?? "",
    url: e?.url ?? `https://github.com/${r.repo}/pull/${r.number}`,
    head: e?.headSha ?? null,
    state: e
      ? e.state === "OPEN"
        ? e.ready
          ? "ready"
          : e.awaitingHuman
            ? "awaiting_human"
            : "not_ready"
        : e.state.toLowerCase()
      : "pending",
    ready: e?.ready ?? false,
    mergeableNow: e?.mergeableNow ?? false,
    awaitingHuman: e?.awaitingHuman ?? false,
    reasons: e?.reasons ?? [],
    autoMerge: r.autoMerge,
    sessionId: r.sessionId,
    reviewRequestedHead: r.reviewRequestedHead,
    updatedAt: r.updatedAt,
  };
}

export function formatSummaries(list: PrSummary[], opts: { daemon: string } = { daemon: "" }) {
  const lines: string[] = [];
  if (opts.daemon) lines.push(opts.daemon);
  if (!list.length) lines.push("No tracked PRs.");
  for (const s of list) {
    const flags = [s.mergeableNow ? "mergeable now" : "", s.autoMerge ? "auto-merge" : ""]
      .filter(Boolean)
      .join(", ");
    lines.push(`${s.pr} [${s.state}]${flags ? ` (${flags})` : ""} ${s.title}`.trimEnd());
    for (const r of s.reasons) lines.push(`  - ${r.code}: ${r.detail}`);
  }
  return lines.join("\n");
}
