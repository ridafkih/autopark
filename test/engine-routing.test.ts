import { describe, expect, test } from "bun:test";
import { REPO, snapshot } from "./fixtures/build.ts";
import { FakeClock } from "./fixtures/clock.ts";
import { createHarness, pullRequestPayload, repository } from "./fixtures/harness.ts";
import { reviewDelivery } from "./fixtures/review-delivery.ts";

describe("routing through the engine", () => {
  test("push to the base branch rechecks every PR on that base", async () => {
    const harness = await createHarness();
    harness.github.set(snapshot({ number: 7 }));
    harness.github.set(snapshot({ number: 8, headRef: "bot/other" }));
    harness.github.set(snapshot({ number: 9, headRef: "bot/rel", baseRef: "release" }));
    for (const number of [7, 8, 9]) harness.engine.track(REPO, number);
    await harness.engine.idle();
    const result = await harness.engine.handleDelivery({
      id: "p1",
      event: "push",
      payload: { ref: "refs/heads/main", repository },
    });
    await harness.engine.idle();
    expect(result.scheduled.toSorted()).toEqual(["acme/widgets#7", "acme/widgets#8"]);
    const reads = [7, 8, 9].map((number) => harness.github.readsOf(REPO, number));
    expect(reads).toEqual([2, 2, 1]);
  });

  test("pull_request opened auto-tracks a matching PR", async () => {
    const harness = await createHarness();
    harness.github.set(snapshot());
    await harness.engine.handleDelivery({
      id: "o1",
      event: "pull_request",
      payload: { action: "opened", pull_request: pullRequestPayload(7), repository },
    });
    await harness.engine.idle();
    expect(harness.store.getPullRequest("acme/widgets#7")).toMatchObject({
      tracked: true,
      source: "filter",
    });
    expect(harness.kinds()).toContain("ready");
  });

  test("an untracked PR is not re-tracked by the filter", async () => {
    const harness = await createHarness();
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    harness.engine.untrack(REPO, 7);
    await harness.engine.handleDelivery({
      id: "s1",
      event: "pull_request",
      payload: { action: "synchronize", pull_request: pullRequestPayload(7), repository },
    });
    await harness.engine.idle();
    expect(harness.engine.status()).toEqual([]);
  });

  test("non-matching PRs and unknown repos are ignored", async () => {
    const harness = await createHarness();
    await harness.engine.handleDelivery({
      id: "o1",
      event: "pull_request",
      payload: {
        action: "opened",
        pull_request: pullRequestPayload(7, { user: { login: "someone" } }),
        repository,
      },
    });
    await harness.engine.handleDelivery({
      id: "o2",
      event: "pull_request",
      payload: {
        action: "opened",
        pull_request: pullRequestPayload(7),
        repository: { full_name: "other/repo" },
      },
    });
    await harness.engine.idle();
    expect(harness.engine.status()).toEqual([]);
  });

  test("bursts coalesce into one read after the debounce window", async () => {
    const clock = new FakeClock();
    const harness = await createHarness({ clock, config: { daemon: { debounceMs: 500 } } });
    harness.github.set(snapshot());
    harness.engine.track(REPO, 7);
    await clock.advance(500);
    expect(harness.github.readsOf(REPO, 7)).toBe(1);
    for (const id of ["a", "b", "c", "d", "e"]) {
      await harness.engine.handleDelivery(reviewDelivery(id));
    }
    await clock.advance(499);
    expect(harness.github.readsOf(REPO, 7)).toBe(1);
    await clock.advance(1);
    await harness.engine.idle();
    expect(harness.github.readsOf(REPO, 7)).toBe(2);
  });

  test("an event during a recompute triggers exactly one more", async () => {
    const clock = new FakeClock();
    const harness = await createHarness({ clock });
    harness.github.script(snapshot({ mergeable: "UNKNOWN" }), snapshot());
    harness.engine.track(REPO, 7);
    await clock.advance(0);
    await harness.engine.handleDelivery(reviewDelivery("mid1"));
    await harness.engine.handleDelivery(reviewDelivery("mid2"));
    await clock.advance(1000);
    await harness.engine.idle();
    expect(harness.github.readsOf(REPO, 7)).toBe(3);
  });

  test("merged PRs stop being tracked", async () => {
    const harness = await createHarness();
    harness.github.set(snapshot({ state: "MERGED" }));
    harness.engine.track(REPO, 7);
    await harness.engine.idle();
    expect(harness.engine.status()).toEqual([]);
    await harness.engine.handleDelivery(reviewDelivery("late"));
    await harness.engine.idle();
    expect(harness.github.readsOf(REPO, 7)).toBe(1);
  });
});
