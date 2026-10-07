import type { BaseComparison, Snapshot } from "../core/types.ts";
import type { Candidate } from "../core/track.ts";

export interface GitHub {
  viewer(): Promise<string>;
  fetchPr(repo: string, number: number): Promise<Snapshot>;
  compare(repo: string, headSha: string, baseSha: string): Promise<BaseComparison>;
  searchOpenPrs(repo: string, author: string | null): Promise<Candidate[]>;
  merge(repo: string, number: number, sha: string, method: "merge" | "squash" | "rebase"): Promise<void>;
}
