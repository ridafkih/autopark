import { afterEach, describe, expect, test } from "bun:test";
import type { PullRequestSummary } from "../src/core/summary.ts";
import { controlFetch } from "../src/daemon/client.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import { snapshot } from "./fixtures/build.ts";
import { bootDaemon, readLog, stopDaemons } from "./fixtures/daemon-boot.ts";
import { FIRST_HEAD, SECOND_HEAD } from "./fixtures/replay/build.ts";
import {
  LIFECYCLE_STEPS,
  type LifecycleStep,
  type World,
} from "./fixtures/replay/lifecycle-steps.ts";

type Daemon = Awaited<ReturnType<typeof bootDaemon>>["daemon"];

interface StepContext {
  source: ReplaySource;
  daemon: Daemon;
  world: World;
}

afterEach(stopDaemons);

const EXPECTED_KINDS = {
  opened: ["not_ready"],
  "build fails": ["checks_failed"],
  "redelivered failure": [],
  "push H2": ["head_moved"],
  "checks pass": ["checks_passed"],
  "greptile scores H2": ["review_scored", "awaiting_human"],
  "approved on H2": ["approved_on_head", "ready"],
  "main moved, webhook missed, forwarder reconnects": ["conflicted", "not_ready"],
  "push H3 merging main": ["head_moved", "conflict_resolved", "checks_passed", "approval_stale"],
  "greptile scores H3": ["review_scored", "awaiting_human"],
  "approved on H3": ["approved_on_head", "ready"],
  merged: ["merged"],
};

async function readStatus(socket: string) {
  const response = await controlFetch(socket, "/status");
  return (await response.json()) as { prs: PullRequestSummary[] };
}

async function playStep({ mutate, delivery }: LifecycleStep, context: StepContext) {
  const { source, daemon, world } = context;
  const before = readLog(daemon.paths.log).length;
  mutate?.(world);
  if (delivery === "reconnect") {
    source.reconnect("gh webhook forward connected for acme/widgets");
  } else {
    await source.push(delivery);
  }
  await daemon.engine.idle();
  return readLog(daemon.paths.log)
    .slice(before)
    .map((transition) => transition.kind);
}

async function expectReadyOverControlSocket(daemon: Daemon) {
  const status = await readStatus(daemon.paths.socket);
  expect(status.prs[0]).toMatchObject({
    pr: "acme/widgets#7",
    state: "ready",
    mergeableNow: true,
    head: SECOND_HEAD,
  });
}

describe("daemon end to end through the replay adapter", () => {
  test("fixture webhooks drive the PR lifecycle into the transition log", async () => {
    const source = new ReplaySource();
    const { github, daemon } = await bootDaemon({ source });
    const world: World = (overrides) => github.set(snapshot(overrides));
    const context: StepContext = { source, daemon, world };
    const perStep: Record<string, string[]> = {};
    for (const step of LIFECYCLE_STEPS) {
      perStep[step.label] = await playStep(step, context);
      if (step.label === "approved on H2") await expectReadyOverControlSocket(daemon);
    }
    expect(perStep).toEqual(EXPECTED_KINDS);

    const log = readLog(daemon.paths.log);
    const firstId = log[0]?.id ?? Number.NaN;
    expect(log.map((transition) => transition.id)).toEqual(
      [...log.keys()].map((index) => firstId + index),
    );
    expect(log.find((transition) => transition.kind === "checks_failed")).toMatchObject({
      head: FIRST_HEAD,
      data: { names: ["build"], required: ["build"] },
      url: "https://github.com/acme/widgets/pull/7",
    });
    expect(daemon.engine.status()).toEqual([]);
  });
});
