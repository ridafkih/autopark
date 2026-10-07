import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseRef, repoFromRemote } from "../src/cli/ref.ts";
import { scopesFrom } from "../src/cli/doctor.ts";
import { configJsonSchema } from "../src/config/schema.ts";

const ROOT = resolve(import.meta.dir, "..");

describe("parseRef", () => {
  test.each([
    ["owner/repo#n", "acme/widgets#12", null, { repo: "acme/widgets", number: 12 }],
    [
      "PR url",
      "https://github.com/acme/widgets/pull/12",
      null,
      { repo: "acme/widgets", number: 12 },
    ],
    [
      "PR url with a tab suffix",
      "https://github.com/acme/widgets/pull/12/files",
      null,
      { repo: "acme/widgets", number: 12 },
    ],
    [
      "bare number uses the default repo",
      "12",
      "acme/widgets",
      { repo: "acme/widgets", number: 12 },
    ],
    [
      "hash number uses the default repo",
      "#12",
      "acme/widgets",
      { repo: "acme/widgets", number: 12 },
    ],
  ] as const)("%s", (_l, input, def, expected) => {
    expect(parseRef(input, def)).toEqual(expected);
  });

  test.each([
    ["bare number without a default repo", "12", /owner\/repo#12/],
    ["garbage", "not-a-pr", /not a PR reference/],
  ] as const)("rejects %s", (_l, input, err) => {
    expect(() => parseRef(input, null)).toThrow(err);
  });
});

test.each([
  ["git@github.com:acme/widgets.git", "acme/widgets"],
  ["https://github.com/acme/widgets.git", "acme/widgets"],
  ["https://github.com/acme/widgets", "acme/widgets"],
  ["ssh://git@github.com/acme/widgets.git", "acme/widgets"],
  ["https://gitlab.com/acme/widgets.git", null],
])("repoFromRemote(%s)", (url, expected) => {
  expect(repoFromRemote(url)).toBe(expected);
});

test.each([
  [
    "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
    ["gist", "read:org", "repo", "workflow"],
  ],
  ["  - Token scopes: admin:repo_hook, repo", ["admin:repo_hook", "repo"]],
  ["no scopes line", []],
])("scopesFrom %#", (text, expected) => {
  expect(scopesFrom(text)).toEqual(expected);
});

function project() {
  const dir = mkdtempSync(join(tmpdir(), "apl-cli-"));
  const home = join(dir, "home");
  const proj = join(dir, "proj");
  Bun.spawnSync(["mkdir", "-p", proj]);
  writeFileSync(join(proj, ".pr-autopilot.yaml"), "repos:\n  - acme/widgets\n");
  return { dir, home, proj };
}

async function cli(args: string[], o: { cwd: string; home: string }) {
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli/main.ts"), ...args], {
    cwd: o.cwd,
    env: { ...process.env, PR_AUTOPILOT_HOME: o.home, CLAUDE_SESSION_ID: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

describe("cli commands", () => {
  test("status before anything exists", async () => {
    const { home, proj } = project();
    expect((await cli(["status"], { cwd: proj, home })).stdout).toBe(
      "daemon: not running (no state yet)\nNo tracked PRs.",
    );
  });

  test("offline track, auto-merge, status and untrack round-trip through the state db", async () => {
    const { home, proj } = project();
    expect((await cli(["track", "7", "--session", "s1"], { cwd: proj, home })).stdout).toBe(
      "tracking acme/widgets#7 (daemon not running; it will evaluate on start)",
    );
    expect((await cli(["auto-merge", "#7", "on"], { cwd: proj, home })).code).toBe(0);
    const text = await cli(["status"], { cwd: proj, home });
    expect(text.stdout).toBe(
      "daemon: not running (last known state)\nacme/widgets#7 [pending] (auto-merge)",
    );
    const json = JSON.parse(
      (await cli(["status", "--json", "--session", "s1"], { cwd: proj, home })).stdout,
    );
    expect(json.prs).toHaveLength(1);
    expect(json.prs[0]).toMatchObject({ pr: "acme/widgets#7", autoMerge: true, sessionId: "s1" });
    expect(
      JSON.parse(
        (await cli(["status", "--json", "--session", "other"], { cwd: proj, home })).stdout,
      ).prs,
    ).toEqual([]);
    await cli(["untrack", "acme/widgets#7"], { cwd: proj, home });
    expect((await cli(["status"], { cwd: proj, home })).stdout).toBe(
      "daemon: not running (last known state)\nNo tracked PRs.",
    );
  });

  test("init scaffolds a valid config and registers it", async () => {
    const { home, dir } = project();
    const repo = join(dir, "fresh");
    Bun.spawnSync(["git", "init", "-q", repo]);
    const r = await cli(["init", "--repo", "acme/gadgets"], { cwd: repo, home });
    expect(r.code).toBe(0);
    const file = join(repo, ".pr-autopilot.yaml");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(join(home, "projects.json"), "utf8"))).toEqual([
      Bun.spawnSync(["realpath", file]).stdout.toString().trim(),
    ]);
    expect((await cli(["validate"], { cwd: repo, home })).code).toBe(0);
    expect((await cli(["init", "--repo", "acme/gadgets"], { cwd: repo, home })).code).toBe(1);
  });

  test("register adds a valid config kept outside any repo, once", async () => {
    const { home, dir } = project();
    const file = join(dir, "ando.yaml");
    writeFileSync(file, "repos:\n  - acme/widgets\n");
    expect((await cli(["register", file], { cwd: dir, home })).stdout).toBe(
      `registered ${file} (acme/widgets)`,
    );
    expect((await cli(["register", file], { cwd: dir, home })).stdout).toBe(
      `already registered ${file} (acme/widgets)`,
    );
    expect(JSON.parse(readFileSync(join(home, "projects.json"), "utf8"))).toEqual([file]);
    writeFileSync(join(dir, "bad.yaml"), "repos: []\n");
    expect((await cli(["register", join(dir, "bad.yaml")], { cwd: dir, home })).code).toBe(1);
  });

  test("validate reports each issue with its path", async () => {
    const { home, proj } = project();
    writeFileSync(join(proj, "bad.yaml"), "repos: [nope]\nreadiness:\n  minApprovals: -1\n");
    const r = await cli(["validate", "bad.yaml"], { cwd: proj, home });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("repos[0]: must match");
    expect(r.stderr).toContain("readiness.minApprovals: must be >= 0");
  });

  test("schema prints the generated JSON Schema", async () => {
    const { home, proj } = project();
    expect(JSON.parse((await cli(["schema"], { cwd: proj, home })).stdout)).toEqual(
      configJsonSchema(),
    );
  });

  test("daemon install --print renders the unit without installing", async () => {
    const { home, proj } = project();
    const r = await cli(["daemon", "install", "--print"], { cwd: proj, home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      process.platform === "darwin" ? "<string>dev.pr-autopilot.daemon</string>" : "Restart=always",
    );
    expect(r.stdout).toContain(join(ROOT, "src/daemon/main.ts"));
  });

  test("daemon install --print passes --config through as an absolute path", async () => {
    const { home, proj } = project();
    const r = await cli(["daemon", "install", "--print", "--config", ".pr-autopilot.yaml"], {
      cwd: proj,
      home,
    });
    const abs = join(
      Bun.spawnSync(["realpath", proj]).stdout.toString().trim(),
      ".pr-autopilot.yaml",
    );
    expect(r.stdout.includes(abs) || r.stdout.includes(join(proj, ".pr-autopilot.yaml"))).toBe(
      true,
    );
    expect(r.stdout).toContain("--config");
  });

  test("unknown commands fail with usage", async () => {
    const { home, proj } = project();
    const r = await cli(["explode"], { cwd: proj, home });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown command explode");
  });
});
