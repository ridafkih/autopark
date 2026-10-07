import { resolve } from "node:path";
import { loadConfigFile } from "../../config/load.ts";
import { addProject } from "../../daemon/projects.ts";
import { migrateDefaultHome } from "../../daemon/legacy-home.ts";
import { CliError, note, print } from "../output.ts";
import { describeIssues } from "../project.ts";
import type { Invocation } from "./types.ts";

export async function registerConfig({ argv, paths }: Invocation) {
  const [path] = argv;
  if (!path) throw new CliError("usage: autopark register <config path>");
  migrateDefaultHome(paths, note);
  const loaded = await loadConfigFile(resolve(path));
  if (!loaded.ok) throw new CliError(describeIssues(path, loaded.issues));
  const verb = addProject(paths.projects, path) ? "registered" : "already registered";
  print(`${verb} ${resolve(path)} (${loaded.config.repos.join(", ")})`);
}
