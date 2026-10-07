import type { Config } from "../config/schema.ts";
import { shortSha } from "../core/format.ts";
import type { Evaluation, Transition } from "../core/types.ts";
import type { GitHub } from "../github/types.ts";
import { transitionEnv } from "./notify.ts";
import type { CommandRunner } from "./runner.ts";
import type { PullRequestRecord } from "./store.ts";

type AutoMergeConfig = Config["autoMerge"];

interface MergeDependencies {
  github: GitHub;
  runner: CommandRunner;
}

export function isAutoMergeEnabled(
  record: PullRequestRecord,
  evaluation: Evaluation,
  config: AutoMergeConfig,
) {
  if (record.autoMerge !== null) return record.autoMerge;
  return config.default || evaluation.labels.some((label) => config.labels.includes(label));
}

export const mergeAttempt = (evaluation: Evaluation, config: AutoMergeConfig): Transition => ({
  kind: "merge_attempted",
  repo: evaluation.repo,
  number: evaluation.number,
  head: evaluation.headSha,
  reason: "",
  data: { method: config.method },
});

export const mergeSucceeded = (attempt: Transition, config: AutoMergeConfig): Transition => ({
  ...attempt,
  reason: `auto-merge (${config.method}) requested for ${shortSha(attempt.head ?? "")}`,
  data: { method: config.method, ok: true },
});

export const mergeFailed = (
  attempt: Transition,
  config: AutoMergeConfig,
  message: string,
): Transition => ({
  ...attempt,
  reason: `auto-merge failed: ${message}`,
  data: { method: config.method, ok: false, error: message },
});

export async function runMerge(
  attempt: Transition,
  evaluation: Evaluation,
  config: AutoMergeConfig,
  { github, runner }: MergeDependencies,
) {
  if (!config.command) {
    await github.merge(evaluation.repo, evaluation.number, evaluation.headSha, config.method);
    return;
  }
  const logged = { ...attempt, id: 0, ts: "", title: evaluation.title, url: evaluation.url };
  const env = { ...transitionEnv(logged), PR_AUTOPILOT_MERGE_METHOD: config.method };
  const result = await runner.run(config.command, env);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `merge command exited ${result.code}`);
  }
}
