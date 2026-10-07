import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { addProject } from "../../daemon/projects.ts";
import { gitRoot } from "../git.ts";
import { CliError, print } from "../output.ts";
import { defaultRepo } from "../project.ts";
import { initTemplate } from "../template.ts";
import type { Invocation } from "./types.ts";

export async function initProject({ argv, paths }: Invocation) {
  const { values } = parseArgs({
    args: argv,
    options: { repo: { type: "string" }, force: { type: "boolean" } },
  });
  const file = join(await gitRoot(), ".pr-autopilot.yaml");
  if (existsSync(file) && !values.force) {
    throw new CliError(`${file} exists; pass --force to overwrite`);
  }
  const repo = values.repo ?? (await defaultRepo(null));
  if (!repo) throw new CliError("could not detect the GitHub repo; pass --repo owner/name");
  writeFileSync(file, initTemplate(repo));
  addProject(paths.projects, file);
  print(`wrote ${file} and registered it in ${paths.projects}`);
}
