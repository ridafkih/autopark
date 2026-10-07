import { afterEach, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { ConfigSet } from "../src/daemon/config-set.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import { config, snapshot } from "./fixtures/build.ts";
import { bootDaemon, readLog, stopDaemons } from "./fixtures/daemon-boot.ts";
import { ImmediateClock } from "./fixtures/immediate-clock.ts";
import { deliveries, SECOND_HEAD } from "./fixtures/replay/build.ts";
import { numberAt } from "../src/core/json.ts";

const ROOT = resolve(import.meta.dir, "..");

afterEach(stopDaemons);

describe("daemon end to end through the replay adapter", () => {
  test("a replay file named in the config is delivered at start, deduped and evaluated", async () => {
    const { daemon } = await bootDaemon({
      configDir: join(ROOT, "test/fixtures/replay"),
      config: {
        daemon: { debounceMs: 0, source: { type: "replay", options: { file: "lifecycle.jsonl" } } },
      },
      prepare: (github) => github.set(snapshot({ headSha: SECOND_HEAD })),
    });
    expect(daemon.source.name).toBe("replay");
    await daemon.engine.idle();
    expect(readLog(daemon.paths.log).map((transition) => transition.kind)).toEqual([
      "checks_passed",
      "review_scored",
      "approved_on_head",
      "ready",
    ]);
    const row: unknown = daemon.store.db.query("SELECT COUNT(*) AS n FROM deliveries").get();
    expect(numberAt(row, "n")).toBe(6);
  });

  test("cli status talks to the running daemon over its control socket", async () => {
    const source = new ReplaySource();
    const { github, daemon, home } = await bootDaemon({ source });
    github.set(snapshot({ headSha: SECOND_HEAD }));
    await source.push(deliveries.opened);
    await daemon.engine.idle();
    const subprocess = Bun.spawn([process.execPath, join(ROOT, "src/cli/main.ts"), "status"], {
      env: { ...process.env, AUTOPARK_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, code] = await Promise.all([
      new Response(subprocess.stdout).text(),
      subprocess.exited,
    ]);
    expect(code).toBe(0);
    expect(output.trim()).toBe(
      `daemon: running (pid ${process.pid}, replay connected)\nacme/widgets#7 [ready] (mergeable now) Tidy the widget loader`,
    );
  });

  test("a second daemon on the same state dir refuses to start", async () => {
    const { home, github } = await bootDaemon({ source: new ReplaySource() });
    const configs = await ConfigSet.fromConfigs([
      { config: config(), source: join(home, "second.yaml") },
    ]);
    const second = startDaemon({
      configs,
      github,
      home,
      clock: new ImmediateClock(),
      source: new ReplaySource(),
      wake: null,
      nudges: false,
      log: () => {},
    });
    await expect(second).rejects.toThrow(/already running/u);
  });
});
