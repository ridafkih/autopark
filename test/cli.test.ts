import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configJsonSchema } from "../src/config/schema.ts";
import { cliExitCode, cliJson, cliOutput, createProject, ROOT, runCli } from "./fixtures/cli.ts";
import { arrayAt, parseJson } from "../src/core/json.ts";

const readProjects = (home: string) => parseJson(readFileSync(join(home, "projects.json"), "utf8"));

const realPath = (path: string) => Bun.spawnSync(["realpath", path]).stdout.toString().trim();

describe("cli commands", () => {
  test("status before anything exists", async () => {
    const { home, project } = createProject();
    expect(await cliOutput(["status"], { cwd: project, home })).toBe(
      "daemon: not running (no state yet)\nNo tracked PRs.",
    );
  });

  test("offline track, auto-merge, status and untrack round-trip through the state db", async () => {
    const { home, project } = createProject();
    const location = { cwd: project, home };
    expect(await cliOutput(["track", "7", "--session", "s1"], location)).toBe(
      "tracking acme/widgets#7 (daemon not running; it will evaluate on start)",
    );
    expect(await cliExitCode(["auto-merge", "#7", "on"], location)).toBe(0);
    expect(await cliOutput(["status"], location)).toBe(
      "daemon: not running (last known state)\nacme/widgets#7 [pending] (auto-merge)",
    );
    const mine = arrayAt(await cliJson(["status", "--json", "--session", "s1"], location), "prs");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ pr: "acme/widgets#7", autoMerge: true, sessionId: "s1" });
    const other = await cliJson(["status", "--json", "--session", "other"], location);
    expect(arrayAt(other, "prs")).toEqual([]);
    await runCli(["untrack", "acme/widgets#7"], location);
    expect(await cliOutput(["status"], location)).toBe(
      "daemon: not running (last known state)\nNo tracked PRs.",
    );
  });

  test("init scaffolds a valid config and registers it", async () => {
    const { home, dir } = createProject();
    const repo = join(dir, "fresh");
    Bun.spawnSync(["git", "init", "-q", repo]);
    const location = { cwd: repo, home };
    expect(await cliExitCode(["init", "--repo", "acme/gadgets"], location)).toBe(0);
    const file = join(repo, ".pr-autopilot.yaml");
    expect(existsSync(file)).toBe(true);
    expect(readProjects(home)).toEqual([realPath(file)]);
    expect(await cliExitCode(["validate"], location)).toBe(0);
    expect(await cliExitCode(["init", "--repo", "acme/gadgets"], location)).toBe(1);
  });

  test("register adds a valid config kept outside any repo, once", async () => {
    const { home, dir } = createProject();
    const location = { cwd: dir, home };
    const file = join(dir, "ando.yaml");
    writeFileSync(file, "repos:\n  - acme/widgets\n");
    expect(await cliOutput(["register", file], location)).toBe(`registered ${file} (acme/widgets)`);
    expect(await cliOutput(["register", file], location)).toBe(
      `already registered ${file} (acme/widgets)`,
    );
    expect(readProjects(home)).toEqual([file]);
    writeFileSync(join(dir, "bad.yaml"), "repos: []\n");
    expect(await cliExitCode(["register", join(dir, "bad.yaml")], location)).toBe(1);
  });

  test("validate reports each issue with its path", async () => {
    const { home, project } = createProject();
    writeFileSync(join(project, "bad.yaml"), "repos: [nope]\nreadiness:\n  minApprovals: -1\n");
    const result = await runCli(["validate", "bad.yaml"], { cwd: project, home });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("repos[0]: must match");
    expect(result.stderr).toContain("readiness.minApprovals: must be >= 0");
  });

  test("schema prints the generated JSON Schema", async () => {
    const { home, project } = createProject();
    expect(await cliJson(["schema"], { cwd: project, home })).toEqual(configJsonSchema());
  });

  test("daemon install --print renders the unit without installing", async () => {
    const { home, project } = createProject();
    const result = await runCli(["daemon", "install", "--print"], { cwd: project, home });
    const unitMarker =
      process.platform === "darwin" ? "<string>dev.pr-autopilot.daemon</string>" : "Restart=always";
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(unitMarker);
    expect(result.stdout).toContain(join(ROOT, "src/daemon/main.ts"));
  });

  test("daemon install --print passes --config through as an absolute path", async () => {
    const { home, project } = createProject();
    const args = ["daemon", "install", "--print", "--config", ".pr-autopilot.yaml"];
    const result = await runCli(args, { cwd: project, home });
    const absolutePath = join(realPath(project), ".pr-autopilot.yaml");
    const hasAbsolutePath =
      result.stdout.includes(absolutePath) ||
      result.stdout.includes(join(project, ".pr-autopilot.yaml"));
    expect(hasAbsolutePath).toBe(true);
    expect(result.stdout).toContain("--config");
  });

  test("unknown commands fail with usage", async () => {
    const { home, project } = createProject();
    const result = await runCli(["explode"], { cwd: project, home });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown command explode");
  });
});
