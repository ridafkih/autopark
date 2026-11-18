import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveriesFor, type Delivery } from "../../src/channel/deliver.ts";
import { evaluate } from "../../src/core/evaluate.ts";
import { pullRequestKey, type Snapshot, type TransitionKind } from "../../src/core/types.ts";
import { resolvePaths } from "../../src/daemon/paths.ts";
import { Store } from "../../src/daemon/store.ts";
import { config, HEAD, REPO, snapshot } from "./build.ts";
import { openThread } from "./nudge-harness.ts";
import { BASE_TRANSITION } from "./transition.ts";

export const closers: Array<() => void> = [];

const HOUR = 3_600_000;
export const blockedByThreads = { threads: [openThread] };
export const unapproved = { approvals: [] };

export function world() {
  const directory = mkdtempSync(join(tmpdir(), "apl-current-"));
  const paths = resolvePaths(join(directory, "home"));
  const cwd = join(directory, "proj");
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const store = new Store(paths.db);
  closers.push(() => store.close());
  store.track({ repo: REPO, number: 7, source: "explicit", sessionId: "s1", now: 1 });
  store.track({ repo: REPO, number: 8, source: "explicit", sessionId: "s2", now: 1 });
  store.track({ repo: REPO, number: 9, source: "filter", sessionId: null, now: 1 });
  const show = (changes: Partial<Snapshot>, number = 7) => {
    const evaluation = evaluate(
      snapshot({ ...changes, number }),
      config({ reviewers: [] }),
      new Map(),
      null,
    );
    store.saveEvaluation(pullRequestKey(REPO, number), evaluation, 1);
  };
  const holdFor = (number = 7) =>
    store.setHold({
      target: pullRequestKey(REPO, number),
      until: Date.now() + HOUR,
      reason: "waiting on design",
      createdAt: 1,
    });
  return { paths, cwd, store, show, holdFor };
}

export type World = ReturnType<typeof world>;

export interface LineSpec {
  id: number;
  kind: TransitionKind;
  number?: number;
  head?: string;
  data?: Record<string, unknown>;
}

const lineOf = ({ id, kind, number = 7, head = HEAD, data = {} }: LineSpec) =>
  JSON.stringify({ ...BASE_TRANSITION, id, kind, number, head, data, reason: kind });

export async function deliver({ paths, cwd }: World, specs: LineSpec[]) {
  const lines = specs.map(lineOf);
  return deliveriesFor({ lines, sessionId: "s1", cwd, format: "channel" }, paths);
}

export const metaOf = (delivery: Delivery) => (delivery.format === "channel" ? delivery.meta : {});
export const kindsOf = (deliveries: Delivery[]) =>
  deliveries.map((delivery) => metaOf(delivery).kind);

export const nudge = (id = 1, kinds = ["threads_open"], head = HEAD): LineSpec => ({
  id,
  kind: "nudge",
  head,
  data: { kinds },
});

export const metaAt = (deliveries: Delivery[], index: number) => {
  const delivery = deliveries[index];
  return delivery ? metaOf(delivery) : {};
};
