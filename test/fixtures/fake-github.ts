import type { Candidate } from "../../src/core/track.ts";
import { pullRequestKey, type BaseComparison, type Snapshot } from "../../src/core/types.ts";
import type { GitHub } from "../../src/github/types.ts";

interface MergeCall {
  repo: string;
  number: number;
  sha: string;
  method: string;
}

const NO_COMPARISON: BaseComparison = { behindBy: 0, files: [], truncated: false };

export class FakeGitHub implements GitHub {
  readonly snapshots = new Map<string, Snapshot>();
  readonly scripted = new Map<string, Snapshot[]>();
  readonly reads = new Map<string, number>();
  readonly comparisons = new Map<string, BaseComparison>();
  compareCalls = 0;
  searchResults: Candidate[] = [];
  readonly searches: Array<{ repo: string; author: string | null }> = [];
  readonly merges: MergeCall[] = [];
  mergeError: string | null = null;
  login = "octo";

  set(snapshot: Snapshot) {
    this.snapshots.set(pullRequestKey(snapshot.repo, snapshot.number), snapshot);
  }

  script(...snapshots: Snapshot[]) {
    const [first] = snapshots;
    if (!first) throw new Error("script needs at least one snapshot");
    this.scripted.set(pullRequestKey(first.repo, first.number), snapshots);
  }

  readsOf(repo: string, number: number) {
    return this.reads.get(pullRequestKey(repo, number)) ?? 0;
  }

  async viewer() {
    return this.login;
  }

  async fetchPullRequest(repo: string, number: number) {
    const key = pullRequestKey(repo, number);
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    const snapshot = this.nextScripted(key) ?? this.snapshots.get(key);
    if (!snapshot) throw new Error(`no fake PR ${key}`);
    return structuredClone(snapshot);
  }

  async compare(repo: string, head: string, base: string) {
    this.compareCalls = this.compareCalls + 1;
    return this.comparisons.get(`${head}..${base}`) ?? NO_COMPARISON;
  }

  async searchOpenPullRequests(repo: string, author: string | null) {
    this.searches.push({ repo, author });
    const lowerRepo = repo.toLowerCase();
    return this.searchResults.filter((candidate) => candidate.repo.toLowerCase() === lowerRepo);
  }

  async merge(repo: string, number: number, sha: string, method: string) {
    if (this.mergeError) throw new Error(this.mergeError);
    this.merges.push({ repo, number, sha, method });
  }

  private nextScripted(key: string) {
    const queue = this.scripted.get(key);
    if (!queue || queue.length === 0) return;
    return queue.length > 1 ? queue.shift() : queue[0];
  }
}
