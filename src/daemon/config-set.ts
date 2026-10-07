import { dirname } from "node:path";
import { loadConfigFile } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import { loadParsers } from "../reviewers/index.ts";
import type { ReviewerParser } from "../reviewers/types.ts";

export interface RepoEntry {
  config: Config;
  parsers: Map<string, ReviewerParser>;
  source: string;
}

interface LoadedConfig {
  config: Config;
  source: string;
}

function indexByRepo(entries: RepoEntry[]) {
  const byRepo = new Map<string, RepoEntry>();
  for (const entry of entries) {
    for (const repo of entry.config.repos) {
      const existing = byRepo.get(repo.toLowerCase());
      if (existing) {
        throw new Error(`${repo} is configured twice (${existing.source} and ${entry.source})`);
      }
      byRepo.set(repo.toLowerCase(), entry);
    }
  }
  return byRepo;
}

async function loadConfig(path: string): Promise<LoadedConfig> {
  const result = await loadConfigFile(path);
  if (!result.ok) {
    const issues = result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
    throw new Error(`${path}: ${issues}`);
  }
  return { config: result.config, source: path };
}

export class ConfigSet {
  readonly entries: RepoEntry[];
  readonly primary: RepoEntry;
  private readonly byRepo: Map<string, RepoEntry>;

  constructor(entries: RepoEntry[]) {
    const [primary] = entries;
    if (!primary) throw new Error("no autopark config loaded");
    this.entries = entries;
    this.primary = primary;
    this.byRepo = indexByRepo(entries);
  }

  get daemon() {
    return this.primary.config.daemon;
  }

  static async fromConfigs(configs: LoadedConfig[]) {
    const entries: RepoEntry[] = [];
    for (const { config, source } of configs) {
      const parsers = await loadParsers(config.reviewers, dirname(source));
      entries.push({ config, source, parsers });
    }
    return new ConfigSet(entries);
  }

  static async load(paths: string[]) {
    const configs: LoadedConfig[] = [];
    for (const path of paths) configs.push(await loadConfig(path));
    return ConfigSet.fromConfigs(configs);
  }

  get(repo: string) {
    return this.byRepo.get(repo.toLowerCase());
  }

  repos() {
    return this.entries.flatMap((entry) => entry.config.repos);
  }
}
