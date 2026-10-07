import { pullRequestKey, type Snapshot } from "../../src/core/types.ts";
import { REPO, snapshot } from "./build.ts";
import { FakeClock } from "./clock.ts";
import { createHarness } from "./harness.ts";

export const MINUTE = 60_000;
export const KEY = pullRequestKey(REPO, 7);

export const openThread = {
  id: "t1",
  resolved: false,
  outdated: false,
  author: "greptile-apps",
  path: "src/loader.ts",
  url: null,
};

export async function createNudgeHarness(config: Record<string, unknown> = {}) {
  const clock = new FakeClock();
  const harness = await createHarness({ clock, config });
  harness.engine.nudges.start();
  const linesOf = (kind: string) => harness.sink.lines.filter((line) => line.kind === kind);
  const nudges = () => linesOf("nudge");
  const nudgeMinutes = () => nudges().map((line) => Date.parse(line.ts) / MINUTE);
  const trackWith = async (changes: Partial<Snapshot>, number = 7) => {
    harness.github.set(snapshot({ ...changes, number }));
    harness.engine.track(REPO, number, { sessionId: "s1" });
    await harness.engine.idle();
  };
  const show = async (changes: Partial<Snapshot>, number = 7) => {
    harness.github.set(snapshot({ ...changes, number }));
    harness.engine.schedule(pullRequestKey(REPO, number));
    await harness.engine.idle();
  };
  const minutes = (count: number) => clock.advance(count * MINUTE);
  return { ...harness, clock, linesOf, nudges, nudgeMinutes, trackWith, show, minutes };
}
