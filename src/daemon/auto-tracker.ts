import { errorMessage } from "../core/errors.ts";
import { hasTrackFilter, matchesTrackFilter, type Candidate } from "../core/track.ts";
import { pullRequestKey } from "../core/types.ts";
import type { GitHub } from "../github/types.ts";
import type { Clock } from "./clock.ts";
import type { RepoEntry } from "./config-set.ts";
import type { Store } from "./store.ts";

export interface AutoTrackerDependencies {
  store: Store;
  clock: Clock;
  github: GitHub;
  log: (message: string) => void;
  schedule: (key: string) => void;
}

export class AutoTracker {
  private viewerLogin: string | null;

  constructor(private readonly dependencies: AutoTrackerDependencies) {
    this.viewerLogin = dependencies.store.getMeta("viewer");
  }

  async consider(candidate: Candidate, entry: RepoEntry) {
    const { store, clock } = this.dependencies;
    const key = pullRequestKey(candidate.repo, candidate.number);
    if (store.getPullRequest(key)) return;
    const filter = entry.config.track;
    const viewer = filter.authors.includes("@me") ? await this.viewer() : null;
    if (!matchesTrackFilter(candidate, filter, viewer)) return;
    const lowerRepo = candidate.repo.toLowerCase();
    const configuredRepo = entry.config.repos.find((repo) => repo.toLowerCase() === lowerRepo);
    const repo = configuredRepo ?? candidate.repo;
    const { number } = candidate;
    store.track({ repo, number, source: "filter", sessionId: null, now: clock.now() });
    this.dependencies.schedule(key);
  }

  async discover(entry: RepoEntry) {
    const filter = entry.config.track;
    if (!hasTrackFilter(filter)) return;
    const authors = filter.authors.length === 1 ? filter.authors : [null];
    const searches = entry.config.repos.flatMap((repo) =>
      authors.map((author) => ({ repo, author })),
    );
    for (const { repo, author } of searches) await this.discoverIn(entry, repo, author);
  }

  private async discoverIn(entry: RepoEntry, repo: string, author: string | null) {
    try {
      const resolved = author === "@me" ? await this.viewer() : author;
      const candidates = await this.dependencies.github.searchOpenPullRequests(repo, resolved);
      for (const candidate of candidates) await this.consider(candidate, entry);
    } catch (error) {
      this.dependencies.log(`resync search failed for ${repo}: ${errorMessage(error)}`);
    }
  }

  private async viewer() {
    if (!this.viewerLogin) {
      this.viewerLogin = await this.dependencies.github.viewer();
      this.dependencies.store.setMeta("viewer", this.viewerLogin);
    }
    return this.viewerLogin;
  }
}
