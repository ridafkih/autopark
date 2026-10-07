import { dirname } from "node:path";
import type { Config } from "../config/schema.ts";
import { loadConfigFile } from "../config/load.ts";
import { loadParsers } from "../reviewers/index.ts";
import type { ReviewerParser } from "../reviewers/types.ts";

export interface RepoEntry {
  config: Config;
  parsers: Map<string, ReviewerParser>;
  source: string;
}

export class ConfigSet {
  private byRepo = new Map<string, RepoEntry>();
  readonly entries: RepoEntry[];

  constructor(entries: RepoEntry[]) {
    if (!entries.length) throw new Error("no pr-autopilot config loaded");
    this.entries = entries;
    for (const e of entries) {
      for (const repo of e.config.repos) {
        const k = repo.toLowerCase();
        const existing = this.byRepo.get(k);
        if (existing)
          throw new Error(`${repo} is configured twice (${existing.source} and ${e.source})`);
        this.byRepo.set(k, e);
      }
    }
  }

  get(repo: string) {
    return this.byRepo.get(repo.toLowerCase());
  }

  repos() {
    return this.entries.flatMap((e) => e.config.repos);
  }

  get daemon() {
    return this.entries[0]!.config.daemon;
  }

  static async fromConfigs(configs: Array<{ config: Config; source: string }>) {
    const entries: RepoEntry[] = [];
    for (const c of configs)
      entries.push({ ...c, parsers: await loadParsers(c.config.reviewers, dirname(c.source)) });
    return new ConfigSet(entries);
  }

  static async load(paths: string[]) {
    const configs: Array<{ config: Config; source: string }> = [];
    for (const p of paths) {
      const r = await loadConfigFile(p);
      if (!r.ok)
        throw new Error(`${p}: ${r.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
      configs.push({ config: r.config, source: p });
    }
    return ConfigSet.fromConfigs(configs);
  }
}
