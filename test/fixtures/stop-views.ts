import { evaluate } from "../../src/core/evaluate.ts";
import { actionableItems, type TrackedView } from "../../src/core/stop.ts";
import type { Snapshot } from "../../src/core/types.ts";
import { greptile } from "../../src/reviewers/greptile.ts";
import { config, HEAD, snapshot } from "./build.ts";

type StopConfig = ReturnType<typeof config>["hooks"]["stop"];

const parsers = new Map([["greptile", greptile]]);

export const stopConfig = config({
  readiness: { baseFreshness: { policy: "contains-tip" } },
  hooks: { stop: { blockOnHeadMovedWithoutReview: true } },
});

export const view = (
  changes: Partial<Snapshot>,
  extra: Partial<TrackedView> = {},
): TrackedView => ({
  evaluation: evaluate(snapshot(changes), stopConfig, parsers, null),
  sessionId: "s1",
  reviewRequestedHead: HEAD,
  ...extra,
});

export const kindsFor = (
  trackedView: TrackedView,
  hookConfig: StopConfig = stopConfig.hooks.stop,
) =>
  actionableItems([trackedView], hookConfig, { sessionId: "s1", repos: [] }).map(
    (item) => item.kind,
  );
