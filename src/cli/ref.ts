import type { PullRequestLocator } from "../core/types.ts";

export type PullRequestRef = PullRequestLocator;

const PULL_REQUEST_URL = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/u;
const SLUG_REFERENCE = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/u;
const BARE_NUMBER = /^#?(\d+)$/u;
const GITHUB_REMOTE = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/u;

function matchRepoAndNumber(pattern: RegExp, input: string): PullRequestRef | null {
  const [, repo, number] = pattern.exec(input) ?? [];
  if (repo === undefined || number === undefined) return null;
  return { repo, number: Number(number) };
}

function bareReference(input: string, defaultRepo: string | null): PullRequestRef | null {
  const [, number] = BARE_NUMBER.exec(input) ?? [];
  if (number === undefined) return null;
  if (!defaultRepo) {
    throw new Error(`cannot tell which repo ${input} belongs to; use owner/repo#${number}`);
  }
  return { repo: defaultRepo, number: Number(number) };
}

export function parseRef(input: string, defaultRepo: string | null): PullRequestRef {
  const trimmed = input.trim();
  const ref =
    matchRepoAndNumber(PULL_REQUEST_URL, trimmed) ??
    matchRepoAndNumber(SLUG_REFERENCE, trimmed) ??
    bareReference(trimmed, defaultRepo);
  if (!ref) throw new Error(`not a PR reference: ${input}`);
  return ref;
}

export function repoFromRemote(url: string): string | null {
  const [, repo] = GITHUB_REMOTE.exec(url.trim()) ?? [];
  return repo ?? null;
}
