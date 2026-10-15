import { existsSync } from "node:fs";
import { activeHold, type Hold } from "../core/hold.ts";
import { stalenessOf, unevaluated } from "../core/staleness.ts";
import type { TrackedView } from "../core/stop.ts";
import { Store, type PullRequestRecord } from "../daemon/store.ts";

function viewOf(record: PullRequestRecord, holds: Hold[], now: number): TrackedView[] {
  const stale = stalenessOf(record, now);
  if (!record.evaluation && !stale) return [];
  return [
    {
      evaluation: record.evaluation ?? unevaluated(record.repo, record.number),
      sessionId: record.sessionId,
      reviewRequestedHead: record.reviewRequestedHead,
      reviewRequestedReady: record.reviewRequestedReady,
      nudge: record.nudge,
      hold: activeHold(record.key, holds, now),
      stale,
    },
  ];
}

export function readViews(db: string, now: number): TrackedView[] {
  if (!existsSync(db)) return [];
  const store = new Store(db, { readonly: true });
  try {
    const holds = store.listHolds();
    const records = store.listPullRequests({ trackedOnly: true });
    return records.flatMap((record) => viewOf(record, holds, now));
  } finally {
    store.close();
  }
}
