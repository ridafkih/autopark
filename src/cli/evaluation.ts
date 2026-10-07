import { dirname } from "node:path";
import type { Config } from "../config/schema.ts";
import { evaluate } from "../core/evaluate.ts";
import type { PullRequestLocator, Snapshot } from "../core/types.ts";
import { systemClock } from "../daemon/clock.ts";
import type { Paths } from "../daemon/paths.ts";
import { fetchSettled } from "../daemon/settle.ts";
import { GitHubHttp } from "../github/client.ts";
import { loadParsers } from "../reviewers/index.ts";
import { configFor } from "./project.ts";

async function withComparison(
  snapshot: Snapshot,
  config: Config,
  github: GitHubHttp,
  { repo }: PullRequestLocator,
): Promise<Snapshot> {
  const { baseSha } = snapshot;
  const isOff = config.readiness.baseFreshness.policy === "off";
  if (isOff || !baseSha || snapshot.state !== "OPEN") return snapshot;
  const baseComparison = await github.compare(repo, snapshot.headSha, baseSha);
  return { ...snapshot, baseComparison };
}

export async function fetchEvaluation(ref: PullRequestLocator, paths: Paths) {
  const { config, source } = await configFor(ref.repo, paths);
  const parsers = await loadParsers(config.reviewers, source ? dirname(source) : process.cwd());
  const github = new GitHubHttp();
  const settled = await fetchSettled({ github, clock: systemClock }, ref, config.daemon.backoffMs);
  const snapshot = await withComparison(settled.snapshot, config, github, ref);
  return {
    evaluation: evaluate(snapshot, config, parsers, null),
    config,
    cost: github.lastCost,
    reads: settled.reads,
  };
}
