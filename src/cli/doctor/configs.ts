import { existsSync } from "node:fs";
import { findConfig, loadConfigFile } from "../../config/load.ts";
import type { Paths } from "../../daemon/paths.ts";
import { readProjects } from "../../daemon/projects.ts";
import type { Check } from "./check.ts";

interface ConfigResult {
  checks: Check[];
  source: string | null;
  repos: string[];
}

export interface ConfigSurvey {
  checks: Check[];
  sources: Set<string>;
  repos: string[];
}

const NO_CONFIG: Check = {
  level: "fail",
  name: "config",
  detail: "none found",
  hint: "pr-autopilot init",
};

function configPaths(paths: Paths) {
  const found = [findConfig(process.cwd()), ...readProjects(paths.projects)]
    .filter((path): path is string => path !== null)
    .filter((path) => existsSync(path));
  return [...new Set(found)];
}

async function surveyConfig(path: string, registered: string[]): Promise<ConfigResult> {
  const loaded = await loadConfigFile(path);
  if (!loaded.ok) {
    const issues = loaded.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
    const failure: Check = { level: "fail", name: "config", detail: `${path}: ${issues}` };
    return { checks: [failure], source: null, repos: [] };
  }
  const { config } = loaded;
  const loadedCheck: Check = {
    level: "ok",
    name: "config",
    detail: `${path} (${config.repos.join(", ")})`,
  };
  const registryCheck: Check = {
    level: "warn",
    name: "registry",
    detail: `${path} is not registered`,
    hint: "pr-autopilot init --force, or pass --config to the daemon",
  };
  const checks = registered.includes(path) ? [loadedCheck] : [loadedCheck, registryCheck];
  return { checks, source: config.daemon.source.type, repos: config.repos };
}

export async function surveyConfigs(paths: Paths): Promise<ConfigSurvey> {
  const found = configPaths(paths);
  const survey: ConfigSurvey = {
    checks: found.length === 0 ? [NO_CONFIG] : [],
    sources: new Set(),
    repos: [],
  };
  for (const path of found) {
    const result = await surveyConfig(path, readProjects(paths.projects));
    survey.checks.push(...result.checks);
    if (result.source) survey.sources.add(result.source);
    survey.repos.push(...result.repos);
  }
  return survey;
}
