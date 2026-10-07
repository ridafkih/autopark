import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LaunchdService, renderPlist } from "../src/service/launchd.ts";
import { SystemdService, renderUnit } from "../src/service/systemd.ts";
import { serviceFor } from "../src/service/index.ts";
import type { ServiceSpec } from "../src/service/types.ts";
import { RecordingRunner } from "./fixtures/harness.ts";

const spec: ServiceSpec = {
  label: "dev.pr-autopilot.daemon",
  program: [
    "/opt/bun/bin/bun",
    "/plugins/pr autopilot/src/daemon/main.ts",
    "--config",
    "/repo/.pr-autopilot.yaml",
  ],
  env: {
    PATH: "/opt/homebrew/bin:/usr/bin",
    PR_AUTOPILOT_HOME: "/Users/x/.pr-autopilot",
    NOTE: "a<b&c",
  },
  logPath: "/Users/x/.pr-autopilot/daemon.log",
};

describe("launchd", () => {
  const plist = renderPlist(spec);

  test("keeps the daemon alive and logs to the state dir", () => {
    expect(plist).toContain("<key>Label</key>\n  <string>dev.pr-autopilot.daemon</string>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<string>/Users/x/.pr-autopilot/daemon.log</string>");
  });

  test("passes program arguments and env verbatim, xml-escaped", () => {
    expect(plist).toContain("<string>/plugins/pr autopilot/src/daemon/main.ts</string>");
    expect(plist).toContain("<key>NOTE</key>\n    <string>a&lt;b&amp;c</string>");
  });

  test("install writes the plist and bootstraps it; uninstall boots it out", async () => {
    const directory = mkdtempSync(join(tmpdir(), "apl-"));
    const runner = new RecordingRunner();
    const service = new LaunchdService({ agentsDir: directory, uid: 501, runner });
    const file = await service.install(spec);
    expect(file).toBe(join(directory, "dev.pr-autopilot.daemon.plist"));
    expect(readFileSync(file, "utf8")).toBe(plist);
    await service.uninstall(spec.label);
    expect(runner.calls.map((call) => call.command)).toEqual([
      `launchctl bootout gui/501/dev.pr-autopilot.daemon 2>/dev/null; launchctl bootstrap gui/501 '${file}'`,
      "launchctl bootout gui/501/dev.pr-autopilot.daemon",
    ]);
    expect(existsSync(file)).toBe(false);
  });
});

describe("systemd", () => {
  const unit = renderUnit(spec);

  test("restarts always and quotes arguments with spaces", () => {
    expect(unit).toContain(
      'ExecStart=/opt/bun/bin/bun "/plugins/pr autopilot/src/daemon/main.ts" --config /repo/.pr-autopilot.yaml',
    );
    expect(unit).toContain("Restart=always");
    expect(unit).toContain('Environment="PR_AUTOPILOT_HOME=/Users/x/.pr-autopilot"');
    expect(unit).toContain("WantedBy=default.target");
  });

  test("install enables the user unit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "apl-"));
    const runner = new RecordingRunner();
    const service = new SystemdService({ unitDir: directory, runner });
    const file = await service.install(spec);
    expect(file).toBe(join(directory, "dev.pr-autopilot.daemon.service"));
    expect(runner.calls.map((call) => call.command)).toEqual([
      "systemctl --user daemon-reload && systemctl --user enable --now 'dev.pr-autopilot.daemon.service'",
    ]);
  });
});

test.each([
  ["darwin", "launchd"],
  ["linux", "systemd"],
  ["win32", null],
] as const)("platform %s uses %s", (platform, kind) => {
  expect(serviceFor(platform, new RecordingRunner())?.kind ?? null).toBe(kind);
});
