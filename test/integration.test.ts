import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigSet } from "../src/daemon/config-set.ts";
import { controlFetch } from "../src/daemon/client.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import { check, config, greptileComment, snap } from "./fixtures/build.ts";
import { ImmediateClock } from "./fixtures/clock.ts";
import { FakeGitHub } from "./fixtures/fake-github.ts";
import { RecordingRunner } from "./fixtures/harness.ts";
import { deliveries, H1, H2, H3 } from "./fixtures/replay/build.ts";
import type { LoggedTransition, Snapshot } from "../src/core/types.ts";

const ROOT = resolve(import.meta.dir, "..");
let stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const s of stops) await s();
  stops = [];
});

const readLog = (path: string): LoggedTransition[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

async function boot(
  opts: {
    source?: ReplaySource;
    cfg?: Record<string, unknown>;
    configDir?: string;
    prepare?: (gh: FakeGitHub) => void;
  } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "apl-int-"));
  const github = new FakeGitHub();
  opts.prepare?.(github);
  const configs = await ConfigSet.fromConfigs([
    { config: config(opts.cfg), source: join(opts.configDir ?? home, ".pr-autopilot.yaml") },
  ]);
  const daemon = await startDaemon({
    configs,
    github,
    home,
    clock: new ImmediateClock(),
    source: opts.source,
    wake: null,
    runner: new RecordingRunner(),
    log: () => {},
  });
  stops.push(() => daemon.stop());
  return { home, github, daemon };
}

describe("daemon end to end through the replay adapter", () => {
  test("fixture webhooks drive the PR lifecycle into the transition log", async () => {
    const source = new ReplaySource();
    const { github, daemon } = await boot({ source });
    const world = (s: Partial<Snapshot>) => github.set(snap(s));
    const pending = [check("build", "pending")];

    const steps: Array<
      [string, (() => void) | null, (typeof deliveries)[keyof typeof deliveries] | "reconnect"]
    > = [
      [
        "opened",
        () => world({ headSha: H1, checks: pending, approvals: [], comments: [] }),
        deliveries.opened,
      ],
      [
        "build fails",
        () => world({ headSha: H1, checks: [check("build", "fail")], approvals: [], comments: [] }),
        deliveries.buildFailed,
      ],
      ["redelivered failure", null, deliveries.buildFailed],
      [
        "push H2",
        () => world({ headSha: H2, checks: pending, approvals: [], comments: [] }),
        deliveries.synchronize2,
      ],
      [
        "checks pass",
        () => world({ headSha: H2, approvals: [], comments: [] }),
        deliveries.suitePassed,
      ],
      ["greptile scores H2", () => world({ headSha: H2, approvals: [] }), deliveries.greptile2],
      ["approved on H2", () => world({ headSha: H2 }), deliveries.approved2],
      [
        "main moved, webhook missed, forwarder reconnects",
        () => world({ headSha: H2, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
        "reconnect",
      ],
      [
        "push H3 merging main",
        () =>
          world({
            headSha: H3,
            approvals: [{ login: "reviewer", state: "APPROVED", sha: H2 }],
            comments: [greptileComment(5, H2)],
          }),
        deliveries.synchronize3,
      ],
      [
        "greptile scores H3",
        () =>
          world({
            headSha: H3,
            approvals: [{ login: "reviewer", state: "APPROVED", sha: H2 }],
            comments: [greptileComment(5, H3, 2)],
          }),
        deliveries.greptile3,
      ],
      [
        "approved on H3",
        () => world({ headSha: H3, comments: [greptileComment(5, H3, 2)] }),
        deliveries.approved3,
      ],
      [
        "merged",
        () => world({ headSha: H3, state: "MERGED", mergeable: "UNKNOWN" }),
        deliveries.merged,
      ],
    ];

    const perStep: Record<string, string[]> = {};
    for (const [label, mutate, delivery] of steps) {
      const before = readLog(daemon.paths.log).length;
      mutate?.();
      if (delivery === "reconnect")
        source.reconnect("gh webhook forward connected for acme/widgets");
      else await source.push(delivery);
      await daemon.engine.idle();
      perStep[label] = readLog(daemon.paths.log)
        .slice(before)
        .map((t) => t.kind);
      if (label === "approved on H2") {
        const status: any = await (await controlFetch(daemon.paths.socket, "/status")).json();
        expect(status.prs[0]).toMatchObject({
          pr: "acme/widgets#7",
          state: "ready",
          mergeableNow: true,
          head: H2,
        });
      }
    }

    expect(perStep).toEqual({
      opened: ["not_ready"],
      "build fails": ["checks_failed"],
      "redelivered failure": [],
      "push H2": ["head_moved"],
      "checks pass": ["checks_passed"],
      "greptile scores H2": ["review_scored", "awaiting_human"],
      "approved on H2": ["approved_on_head", "ready"],
      "main moved, webhook missed, forwarder reconnects": ["conflicted", "not_ready"],
      "push H3 merging main": [
        "head_moved",
        "conflict_resolved",
        "checks_passed",
        "approval_stale",
      ],
      "greptile scores H3": ["review_scored", "awaiting_human"],
      "approved on H3": ["approved_on_head", "ready"],
      merged: ["merged"],
    });

    const log = readLog(daemon.paths.log);
    expect(log.map((t) => t.id)).toEqual([...log.keys()].map((i) => log[0]!.id + i));
    expect(log.find((t) => t.kind === "checks_failed")).toMatchObject({
      head: H1,
      data: { names: ["build"], required: ["build"] },
      url: "https://github.com/acme/widgets/pull/7",
    });
    expect(daemon.engine.status()).toEqual([]);
  });

  test("a replay file named in the config is delivered at start, deduped and evaluated", async () => {
    const configDir = join(ROOT, "test/fixtures/replay");
    const { daemon } = await boot({
      configDir,
      cfg: {
        daemon: { debounceMs: 0, source: { type: "replay", options: { file: "lifecycle.jsonl" } } },
      },
      prepare: (gh) => gh.set(snap({ headSha: H2 })),
    });
    expect(daemon.source.name).toBe("replay");
    await daemon.engine.idle();
    expect(readLog(daemon.paths.log).map((t) => t.kind)).toEqual([
      "checks_passed",
      "review_scored",
      "approved_on_head",
      "ready",
    ]);
    expect(
      (daemon.store.db.query("SELECT COUNT(*) AS n FROM deliveries").get() as { n: number }).n,
    ).toBe(6);
  });

  test("cli status talks to the running daemon over its control socket", async () => {
    const source = new ReplaySource();
    const { github, daemon, home } = await boot({ source });
    github.set(snap({ headSha: H2 }));
    await source.push(deliveries.opened);
    await daemon.engine.idle();
    const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli/main.ts"), "status"], {
      env: { ...process.env, PR_AUTOPILOT_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(0);
    expect(out.trim()).toBe(
      `daemon: running (pid ${process.pid}, replay connected)\nacme/widgets#7 [ready] (mergeable now) Tidy the widget loader`,
    );
  });

  test("a second daemon on the same state dir refuses to start", async () => {
    const { home, github } = await boot({ source: new ReplaySource() });
    const configs = await ConfigSet.fromConfigs([
      { config: config(), source: join(home, "x.yaml") },
    ]);
    await expect(
      startDaemon({
        configs,
        github,
        home,
        clock: new ImmediateClock(),
        source: new ReplaySource(),
        wake: null,
        log: () => {},
      }),
    ).rejects.toThrow(/already running/);
  });
});
