import type { Candidate } from "../core/track.ts";
import type { Snapshot } from "../core/types.ts";

export type MergeMethod = "merge" | "squash" | "rebase";

export interface GitHub {
  viewer(): Promise<string>;
  fetchPullRequest(repo: string, number: number): Promise<Snapshot>;
  searchOpenPullRequests(repo: string, author: string | null): Promise<Candidate[]>;
  merge(repo: string, number: number, sha: string, method: MergeMethod): Promise<void>;
}
