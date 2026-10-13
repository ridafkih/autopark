import { existsSync } from "node:fs";
import { pullRequestKey, type LoggedTransition } from "../core/types.ts";
import { Store } from "../daemon/store.ts";

export function storeSessionOf(db: string) {
  return (transition: LoggedTransition): string | null => {
    if (!existsSync(db)) return null;
    const store = new Store(db, { readonly: true });
    try {
      const key = pullRequestKey(transition.repo, transition.number);
      return store.getPullRequest(key)?.sessionId ?? null;
    } finally {
      store.close();
    }
  };
}
