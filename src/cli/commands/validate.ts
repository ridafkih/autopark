import { findConfig, loadConfigFile } from "../../config/load.ts";
import { CliError, print } from "../output.ts";
import { describeIssues } from "../project.ts";
import type { Invocation } from "./types.ts";

export async function validateConfig({ argv }: Invocation) {
  const path = argv[0] ?? findConfig(process.cwd());
  if (!path) throw new CliError("no config found");
  const loaded = await loadConfigFile(path);
  if (!loaded.ok) throw new CliError(describeIssues(path, loaded.issues));
  print(`${path}: ok (${loaded.config.repos.join(", ")})`);
}
