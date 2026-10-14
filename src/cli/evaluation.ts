import { dirname } from "node:path";
import { evaluate } from "../core/evaluate.ts";
import type { PullRequestLocator } from "../core/types.ts";
import { systemClock } from "../daemon/clock.ts";
import type { Paths } from "../daemon/paths.ts";
import { fetchSettled } from "../daemon/settle.ts";
import { GitHubHttp } from "../github/client.ts";
import { loadParsers } from "../reviewers/index.ts";
import { configFor } from "./project.ts";

export async function fetchEvaluation(ref: PullRequestLocator, paths: Paths) {
  const { config, source } = await configFor(ref.repo, paths);
  const parsers = await loadParsers(config.reviewers, source ? dirname(source) : process.cwd());
  const github = new GitHubHttp();
  const settled = await fetchSettled({ github, clock: systemClock }, ref, config.daemon.backoffMs);
  return {
    evaluation: evaluate(settled.snapshot, config, parsers, null),
    config,
    cost: github.lastCost,
    reads: settled.reads,
  };
}
