import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pullRequestKey } from "../src/core/types.ts";
import { check, HEAD, HEAD2, REPO } from "./fixtures/build.ts";
import {
  blockedByThreads,
  closers,
  deliver,
  kindsOf,
  type LineSpec,
  metaOf,
  nudge,
  unapproved,
  world,
  type World,
} from "./fixtures/delivery-world.ts";

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("only this session's PRs reach it", () => {
  test("another session's PR and an unbound PR stay out even when the repo is configured", async () => {
    const current = world();
    writeFileSync(join(current.cwd, ".autopark.yaml"), `repos:\n  - ${REPO}\n`);
    const deliveries = await deliver(current, [
      { id: 1, kind: "checks_failed", number: 8 },
      { id: 2, kind: "checks_failed", number: 9 },
      { id: 3, kind: "approval_needed", number: 8 },
      { id: 4, kind: "checks_failed", number: 7 },
    ]);
    expect(deliveries.map((delivery) => metaOf(delivery).pr)).toEqual(["7"]);
  });
});

describe("a nudge is delivered only while it still holds", () => {
  test("a PR still blocked the same way on the same head is nudged", async () => {
    const current = world();
    current.show(blockedByThreads);
    expect(kindsOf(await deliver(current, [nudge()]))).toEqual(["nudge"]);
  });

  test.each([
    [
      "the head moved on",
      (current: World) => current.show({ ...blockedByThreads, headSha: HEAD2 }),
    ],
    [
      "the blocking reasons changed",
      (current: World) => current.show({ checks: [check("build", "fail")] }),
    ],
    ["the PR became ready", (current: World) => current.show({})],
    ["the PR merged", (current: World) => current.show({ ...blockedByThreads, state: "MERGED" })],
    ["the PR closed", (current: World) => current.show({ ...blockedByThreads, state: "CLOSED" })],
    [
      "the PR was held since",
      (current: World) => {
        current.show(blockedByThreads);
        current.holdFor();
      },
    ],
  ])("it is dropped when %s", async (label, arrange) => {
    const current = world();
    arrange(current);
    expect(await deliver(current, [nudge()])).toEqual([]);
  });

  test("it is dropped once the PR is no longer tracked", async () => {
    const current = world();
    current.show(blockedByThreads);
    current.store.setTracked(pullRequestKey(REPO, 7), false);
    expect(await deliver(current, [nudge(), { id: 2, kind: "approval_needed" }])).toEqual([]);
  });

  test("it is dropped when the daemon has no state for the PR", async () => {
    expect(await deliver(world(), [nudge()])).toEqual([]);
  });
});

describe("approval_needed is delivered only while approval is still needed", () => {
  const needed: LineSpec = { id: 1, kind: "approval_needed" };

  test("an unapproved PR with no recorded request is delivered", async () => {
    const current = world();
    current.show(unapproved);
    expect(kindsOf(await deliver(current, [needed]))).toEqual(["approval_needed"]);
  });

  test("a push does not cancel it, since approvals persist across pushes", async () => {
    const current = world();
    current.show({ ...unapproved, headSha: HEAD2 });
    expect(kindsOf(await deliver(current, [needed]))).toEqual(["approval_needed"]);
  });

  test.each([
    ["approved", (current: World) => current.show({})],
    ["merged", (current: World) => current.show({ ...unapproved, state: "MERGED" })],
    ["closed", (current: World) => current.show({ ...unapproved, state: "CLOSED" })],
    [
      "already requested",
      (current: World) => {
        current.show(unapproved);
        current.store.setReviewRequested(pullRequestKey(REPO, 7), HEAD, false);
      },
    ],
  ])("it is dropped once the PR is %s", async (label, arrange) => {
    const current = world();
    arrange(current);
    expect(await deliver(current, [needed])).toEqual([]);
  });
});

describe("hold_expired is delivered only while the PR is still blocked and unheld", () => {
  const expired: LineSpec = { id: 1, kind: "hold_expired" };

  test("a blocked PR whose hold ended is delivered", async () => {
    const current = world();
    current.show(blockedByThreads);
    expect(kindsOf(await deliver(current, [expired]))).toEqual(["hold_expired"]);
  });

  test.each([
    [
      "held again",
      (current: World) => {
        current.show(blockedByThreads);
        current.holdFor();
      },
    ],
    ["merged", (current: World) => current.show({ ...blockedByThreads, state: "MERGED" })],
    ["ready", (current: World) => current.show({})],
  ])("it is dropped once the PR is %s", async (label, arrange) => {
    const current = world();
    arrange(current);
    expect(await deliver(current, [expired])).toEqual([]);
  });
});
