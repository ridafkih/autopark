import type { Snapshot } from "../../../src/core/types.ts";
import { check, greptileComment } from "../build.ts";
import { deliveries, FIRST_HEAD, SECOND_HEAD, THIRD_HEAD } from "./build.ts";

type Delivery = (typeof deliveries)[keyof typeof deliveries];
export type World = (overrides: Partial<Snapshot>) => void;

export interface LifecycleStep {
  label: string;
  mutate: ((world: World) => void) | null;
  delivery: Delivery | "reconnect";
}

const pending = [check("build", "pending")];
const staleApproval = [{ login: "reviewer", state: "APPROVED", sha: SECOND_HEAD }];

const quiet = { approvals: [], comments: [] };

export const LIFECYCLE_STEPS: LifecycleStep[] = [
  {
    label: "opened",
    mutate: (world) => world({ headSha: FIRST_HEAD, checks: pending, ...quiet }),
    delivery: deliveries.opened,
  },
  {
    label: "build fails",
    mutate: (world) => world({ headSha: FIRST_HEAD, checks: [check("build", "fail")], ...quiet }),
    delivery: deliveries.buildFailed,
  },
  { label: "redelivered failure", mutate: null, delivery: deliveries.buildFailed },
  {
    label: "push H2",
    mutate: (world) => world({ headSha: SECOND_HEAD, checks: pending, ...quiet }),
    delivery: deliveries.synchronize2,
  },
  {
    label: "checks pass",
    mutate: (world) => world({ headSha: SECOND_HEAD, ...quiet }),
    delivery: deliveries.suitePassed,
  },
  {
    label: "greptile scores H2",
    mutate: (world) => world({ headSha: SECOND_HEAD, approvals: [] }),
    delivery: deliveries.greptile2,
  },
  {
    label: "approved on H2",
    mutate: (world) => world({ headSha: SECOND_HEAD }),
    delivery: deliveries.approved2,
  },
  {
    label: "main moved, webhook missed, forwarder reconnects",
    mutate: (world) =>
      world({ headSha: SECOND_HEAD, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
    delivery: "reconnect",
  },
  {
    label: "push H3 merging main",
    mutate: (world) =>
      world({
        headSha: THIRD_HEAD,
        approvals: staleApproval,
        comments: [greptileComment(5, SECOND_HEAD)],
      }),
    delivery: deliveries.synchronize3,
  },
  {
    label: "greptile scores H3",
    mutate: (world) =>
      world({
        headSha: THIRD_HEAD,
        approvals: staleApproval,
        comments: [greptileComment(5, THIRD_HEAD, 2)],
      }),
    delivery: deliveries.greptile3,
  },
  {
    label: "approved on H3",
    mutate: (world) =>
      world({ headSha: THIRD_HEAD, comments: [greptileComment(5, THIRD_HEAD, 2)] }),
    delivery: deliveries.approved3,
  },
  {
    label: "merged",
    mutate: (world) => world({ headSha: THIRD_HEAD, state: "MERGED", mergeable: "UNKNOWN" }),
    delivery: deliveries.merged,
  },
];
