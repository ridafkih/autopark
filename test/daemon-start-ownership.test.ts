import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { daemonHealth } from "../src/daemon/client.ts";
import { ConfigSet } from "../src/daemon/config-set.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { resolvePaths } from "../src/daemon/paths.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import type { SourceContext } from "../src/sources/types.ts";
import { config } from "./fixtures/build.ts";
import { bootDaemon, stopDaemons } from "./fixtures/daemon-boot.ts";
import { FakeGitHub } from "./fixtures/fake-github.ts";
import { ImmediateClock } from "./fixtures/immediate-clock.ts";

class PortTakenSource extends ReplaySource {
  override async start(_context: SourceContext) {
    throw new Error("Failed to start server. Is port 8787 in use?");
  }
}

afterEach(stopDaemons);

describe("daemon start ownership", () => {
  test("a start whose event source fails leaves the running daemon's socket and pid file alone", async () => {
    const home = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "apl-own-"));
    const paths = resolvePaths(home);
    writeFileSync(paths.pid, "4242");
    const configs = await ConfigSet.fromConfigs([
      { config: config(), source: join(home, ".autopark.yaml") },
    ]);
    const start = startDaemon({
      configs,
      github: new FakeGitHub(),
      home,
      clock: new ImmediateClock(),
      source: new PortTakenSource(),
      wake: null,
      nudges: false,
      log: () => {},
    });
    await expect(start).rejects.toThrow(/port 8787/u);
    expect(readFileSync(paths.pid, "utf8")).toBe("4242");
    expect(existsSync(paths.socket)).toBe(false);
  });

  test("a running daemon serves its control socket again after the socket file is removed", async () => {
    const { daemon } = await bootDaemon({ source: new ReplaySource() });
    rmSync(daemon.paths.socket, { force: true });
    rmSync(daemon.paths.pid, { force: true });
    expect(await daemonHealth(daemon.paths.socket)).toBeNull();
    daemon.reclaimControl();
    const health = await daemonHealth(daemon.paths.socket);
    expect(health?.pid).toBe(process.pid);
    expect(readFileSync(daemon.paths.pid, "utf8")).toBe(String(process.pid));
  });
});
