import { createHash } from "node:crypto";
import type { Config } from "../config/schema.ts";
import { actionItemsFor, type TrackedView } from "../core/stop.ts";

type StopConfig = Config["hooks"]["stop"];

export interface BriefMemory {
  fingerprint: string | null;
  briefs: number;
}

export const BRIEF_REASON = "No change since last check.";

export const FORGOTTEN: BriefMemory = { fingerprint: null, briefs: 0 };

const DRIFT: Array<[RegExp, string]> = [
  [/\d+ commit\(s\)/gu, "N commit(s)"],
  [/nudged \d+x/gu, "nudged Nx"],
];

const withoutDrift = (detail: string) =>
  DRIFT.reduce((text, [pattern, replacement]) => text.replaceAll(pattern, replacement), detail);

export function fingerprintOf(views: TrackedView[], config: StopConfig) {
  const lines = views
    .flatMap((view) =>
      actionItemsFor(view, config).map((item) =>
        [item.pr, view.evaluation.headSha, item.kind, withoutDrift(item.detail)].join("\t"),
      ),
    )
    .toSorted();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function briefing(fingerprint: string, prior: BriefMemory, maxBriefs: number) {
  const isBrief = fingerprint === prior.fingerprint && prior.briefs < maxBriefs;
  const memory: BriefMemory = { fingerprint, briefs: isBrief ? prior.briefs + 1 : 0 };
  return { isBrief, memory };
}
