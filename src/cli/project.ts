import { existsSync } from "node:fs";
import type { Issue } from "../config/dsl/core.ts";
import { findConfig, loadConfigFile } from "../config/load.ts";
import { defaultConfig, type Config } from "../config/schema.ts";
import type { Paths } from "../daemon/paths.ts";
import { readProjects } from "../daemon/projects.ts";
import { git } from "./git.ts";
import { CliError } from "./output.ts";
import { parseRef, repoFromRemote, type PullRequestRef } from "./ref.ts";

export interface ProjectContext {
  configPath: string | null;
  config: Config | null;
}

export function describeIssues(path: string, issues: Issue[]) {
  const lines = issues.map((issue) => `  ${issue.path}: ${issue.message}`).join("\n");
  return `${path}:\n${lines}`;
}

export async function projectContext(): Promise<ProjectContext> {
  const configPath = findConfig(process.cwd());
  if (!configPath) return { configPath, config: null };
  const loaded = await loadConfigFile(configPath);
  if (!loaded.ok) throw new CliError(describeIssues(configPath, loaded.issues));
  return { configPath, config: loaded.config };
}

export async function defaultRepo(config: Config | null) {
  const onlyRepo = config?.repos.length === 1 ? config.repos.at(0) : undefined;
  if (onlyRepo) return onlyRepo;
  const remote = await git("remote", "get-url", "origin");
  return remote ? repoFromRemote(remote) : null;
}

export async function resolveRef(
  input: string | undefined,
  config: Config | null,
): Promise<PullRequestRef> {
  if (!input) throw new CliError("missing <pr>");
  return parseRef(input, await defaultRepo(config));
}

const servesRepo = (config: Config, repo: string) =>
  config.repos.some((candidate) => candidate.toLowerCase() === repo.toLowerCase());

export async function configFor(repo: string, paths: Paths) {
  const candidates = [findConfig(process.cwd()), ...readProjects(paths.projects)]
    .filter((candidate): candidate is string => candidate !== null)
    .filter((candidate) => existsSync(candidate));
  for (const path of candidates) {
    const loaded = await loadConfigFile(path);
    if (loaded.ok && servesRepo(loaded.config, repo)) {
      return { config: loaded.config, source: path };
    }
  }
  return { config: defaultConfig([repo]), source: null };
}
