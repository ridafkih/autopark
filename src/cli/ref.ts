export interface PullRequestRef {
  repo: string;
  number: number;
}

export function parseRef(input: string, defaultRepo: string | null): PullRequestRef {
  const s = input.trim();
  const url = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(s);
  if (url) return { repo: url[1]!, number: Number(url[2]) };
  const slug = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/.exec(s);
  if (slug) return { repo: slug[1]!, number: Number(slug[2]) };
  const bare = /^#?(\d+)$/.exec(s);
  if (bare) {
    if (!defaultRepo)
      throw new Error(`cannot tell which repo ${s} belongs to; use owner/repo#${bare[1]}`);
    return { repo: defaultRepo, number: Number(bare[1]) };
  }
  throw new Error(`not a PR reference: ${input}`);
}

export function repoFromRemote(url: string): string | null {
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? m[1]! : null;
}
