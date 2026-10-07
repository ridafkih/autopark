import type { BaseComparison, Snapshot } from "../../src/core/types.ts";
import type { Candidate } from "../../src/core/track.ts";
import type { GitHub } from "../../src/github/types.ts";
import { prKey } from "../../src/core/types.ts";

export class FakeGitHub implements GitHub {
  prs = new Map<string, Snapshot>();
  scripted = new Map<string, Snapshot[]>();
  reads = new Map<string, number>();
  comparisons = new Map<string, BaseComparison>();
  compareCalls = 0;
  searchResults: Candidate[] = [];
  searches: Array<{ repo: string; author: string | null }> = [];
  merges: Array<{ repo: string; number: number; sha: string; method: string }> = [];
  mergeError: string | null = null;
  login = "octo";

  set(s: Snapshot) {
    this.prs.set(prKey(s.repo, s.number), s);
  }

  script(...snaps: Snapshot[]) {
    const k = prKey(snaps[0]!.repo, snaps[0]!.number);
    this.scripted.set(k, snaps);
  }

  readsOf(repo: string, n: number) {
    return this.reads.get(prKey(repo, n)) ?? 0;
  }

  async viewer() {
    return this.login;
  }

  async fetchPr(repo: string, number: number) {
    const k = prKey(repo, number);
    this.reads.set(k, (this.reads.get(k) ?? 0) + 1);
    const queue = this.scripted.get(k);
    if (queue?.length) {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return structuredClone(next);
    }
    const s = this.prs.get(k);
    if (!s) throw new Error(`no fake PR ${k}`);
    return structuredClone(s);
  }

  async compare(_repo: string, head: string, base: string) {
    this.compareCalls++;
    return this.comparisons.get(`${head}..${base}`) ?? { behindBy: 0, files: [], truncated: false };
  }

  async searchOpenPrs(repo: string, author: string | null) {
    this.searches.push({ repo, author });
    return this.searchResults.filter((c) => c.repo.toLowerCase() === repo.toLowerCase());
  }

  async merge(repo: string, number: number, sha: string, method: string) {
    if (this.mergeError) throw new Error(this.mergeError);
    this.merges.push({ repo, number, sha, method });
  }
}
