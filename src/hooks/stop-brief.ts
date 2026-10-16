import { createHash } from "node:crypto";
import type { Config } from "../config/schema.ts";
import type { ReviewRequestTiming } from "../core/approval-request.ts";
import { actionItemsFor, type TrackedView } from "../core/stop.ts";

type StopConfig = Config["hooks"]["stop"];

export interface BriefMemory {
  fingerprint: string | null;
}

export const FORGOTTEN: BriefMemory = { fingerprint: null };

export function fingerprintOf(views: TrackedView[], config: StopConfig, when: ReviewRequestTiming) {
  const lines = views
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
    .toSorted();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
