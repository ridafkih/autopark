import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseJson } from "../../src/core/json.ts";

export const ROOT = resolve(import.meta.dir, "../..");

export interface CliLocation {
  cwd: string;
  home: string;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function createProject() {
  const dir = mkdtempSync(join(tmpdir(), "apl-cli-"));
  const home = join(dir, "home");
  const project = join(dir, "proj");
  Bun.spawnSync(["mkdir", "-p", project]);
  writeFileSync(join(project, ".pr-autopilot.yaml"), "repos:\n  - acme/widgets\n");
  return { dir, home, project };
}

export async function runCli(args: string[], { cwd, home }: CliLocation): Promise<CliResult> {
  const subprocess = Bun.spawn([process.execPath, join(ROOT, "src/cli/main.ts"), ...args], {
    cwd,
    env: { ...process.env, PR_AUTOPILOT_HOME: home, CLAUDE_SESSION_ID: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function cliOutput(args: string[], location: CliLocation) {
  const { stdout } = await runCli(args, location);
  return stdout;
}

export async function cliExitCode(args: string[], location: CliLocation) {
  const { code } = await runCli(args, location);
  return code;
}

export async function cliJson(args: string[], location: CliLocation) {
  return parseJson(await cliOutput(args, location));
}
