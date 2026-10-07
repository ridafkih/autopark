import { errorMessage } from "../core/errors.ts";
import type { BaseComparison, Snapshot } from "../core/types.ts";
import type { GitHub } from "../github/types.ts";
import type { RepoEntry } from "./config-set.ts";

const MAX_CACHED_COMPARISONS = 500;

export class ComparisonCache {
  private readonly comparisons = new Map<string, BaseComparison>();

  constructor(
    private readonly github: GitHub,
    private readonly log: (message: string) => void,
  ) {}

  async attach(snapshot: Snapshot, entry: RepoEntry): Promise<Snapshot> {
    const { baseSha, headSha } = snapshot;
    const isOff = entry.config.readiness.baseFreshness.policy === "off";
    if (isOff || snapshot.state !== "OPEN" || !baseSha || !headSha) return snapshot;
    const key = `${snapshot.repo.toLowerCase()}:${headSha}..${baseSha}`;
    const comparison = this.comparisons.get(key) ?? (await this.fetch(snapshot, baseSha, key));
    return comparison ? { ...snapshot, baseComparison: comparison } : snapshot;
  }

  private async fetch(snapshot: Snapshot, baseSha: string, key: string) {
    try {
      const comparison = await this.github.compare(snapshot.repo, snapshot.headSha, baseSha);
      if (this.comparisons.size > MAX_CACHED_COMPARISONS) this.comparisons.clear();
      this.comparisons.set(key, comparison);
      return comparison;
    } catch (error) {
      this.log(`compare ${key} failed: ${errorMessage(error)}`);
      return null;
    }
  }
}
