import { createHash } from "node:crypto";
import type { Config } from "../config/schema.ts";
import type { ReviewRequestTiming } from "../core/approval-request.ts";
import { actionItemsFor, type TrackedView } from "../core/stop.ts";

type StopConfig = Config["hooks"]["stop"];

export interface BriefMemory {
  fingerprint: string | null;
  lines?: string[];
}

export const FORGOTTEN: BriefMemory = { fingerprint: null };

const shortHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

export function linesOf(views: TrackedView[], config: StopConfig, when: ReviewRequestTiming) {
  return views
    .flatMap((view) =>
      actionItemsFor(view, config, when).map((item) =>
        [
          item.repo,
          item.number,
          view.evaluation.headSha,
          item.kind,
          ...(item.fingerprint ?? item.codes),
        ].join("\t"),
      ),
    )
    .map(shortHash)
    .toSorted();
}

export const fingerprintOfLines = (lines: string[]) =>
  createHash("sha256").update(lines.join("\n")).digest("hex");

export function isRepeat(lines: string[], prior: BriefMemory) {
  if (prior.lines === undefined) return fingerprintOfLines(lines) === prior.fingerprint;
  const seen = new Set(prior.lines);
  return lines.every((line) => seen.has(line));
}
