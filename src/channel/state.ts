import { existsSync } from "node:fs";
import type { Hold } from "../core/hold.ts";
import { pullRequestKey, type LoggedTransition } from "../core/types.ts";
import { Store, type PullRequestRecord } from "../daemon/store.ts";

export interface CurrentState {
  records: Map<string, PullRequestRecord>;
  holds: Hold[];
  now: number;
}

const keyOf = (transition: LoggedTransition) => pullRequestKey(transition.repo, transition.number);

function withStore<Result>(db: string, empty: Result, read: (store: Store) => Result): Result {
  if (!existsSync(db)) return empty;
  const store = new Store(db, { readonly: true });
  try {
    return read(store);
  } finally {
    store.close();
  }
}

export function readCurrentState(
  db: string,
  transitions: LoggedTransition[],
  now: number,
): CurrentState {
  const empty: CurrentState = { records: new Map(), holds: [], now };
  return withStore(db, empty, (store) => {
    const keys = [...new Set(transitions.map(keyOf))];
    const records = keys.flatMap((key) => {
      const record = store.getPullRequest(key);
      return record ? [[key, record] as const] : [];
    });
    return { records: new Map(records), holds: store.listHolds(), now };
  });
}

export const recordOf = (state: CurrentState, transition: LoggedTransition) =>
  state.records.get(keyOf(transition)) ?? null;

export const lastTransitionId = (db: string) =>
  withStore(db, 0, (store) => store.lastTransitionId());
