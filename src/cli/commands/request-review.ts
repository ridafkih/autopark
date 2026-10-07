import { formatPullRequest, shortSha } from "../../core/format.ts";
import { fillTemplate } from "../../core/template.ts";
import { pullRequestKey } from "../../core/types.ts";
import { transitionEnv } from "../../daemon/notify.ts";
import { shellRunner } from "../../daemon/runner.ts";
import { callDaemon, loadStatus, withOfflineStore } from "../daemon-api.ts";
import { fetchEvaluation } from "../evaluation.ts";
import { CliError, print } from "../output.ts";
import { configFor, projectContext, resolveRef } from "../project.ts";
import type { PullRequestRef } from "../ref.ts";
import type { Paths } from "../../daemon/paths.ts";
import type { Invocation } from "./types.ts";

interface ReviewTarget {
  head: string;
  title: string;
  url: string;
}

async function reviewTarget(ref: PullRequestRef, paths: Paths): Promise<ReviewTarget> {
  const status = await loadStatus(paths);
  const summary = status.pullRequests.find(
    (candidate) =>
      candidate.repo.toLowerCase() === ref.repo.toLowerCase() && candidate.number === ref.number,
  );
  if (summary?.head) return { head: summary.head, title: summary.title, url: summary.url };
  const { evaluation } = await fetchEvaluation(ref, paths);
  return { head: evaluation.headSha, title: evaluation.title, url: evaluation.url };
}

async function runReviewCommand(command: string, ref: PullRequestRef, target: ReviewTarget) {
  const env = transitionEnv({
    id: 0,
    ts: "",
    kind: "awaiting_human",
    ...ref,
    head: target.head,
    reason: "review requested",
    data: {},
    title: target.title,
    url: target.url,
  });
  const result = await shellRunner.run(command, env);
  if (result.stdout.trim()) print(result.stdout.trim());
  if (result.code !== 0) {
    throw new CliError(`review request command exited ${result.code}: ${result.stderr.trim()}`);
  }
}

async function recordReviewRequest(paths: Paths, ref: PullRequestRef, head: string) {
  if (await callDaemon(paths, "POST", "/review-requested", { ...ref, head })) return;
  withOfflineStore(paths, (store) =>
    store.setReviewRequested(pullRequestKey(ref.repo, ref.number), head),
  );
}

export async function requestReview({ argv, paths }: Invocation) {
  const { config: localConfig } = await projectContext();
  const ref = await resolveRef(argv[0], localConfig);
  const { config } = await configFor(ref.repo, paths);
  const target = await reviewTarget(ref, paths);
  const { command, instruction } = config.reviewRequest;
  if (!command && !instruction) {
    throw new CliError("no reviewRequest.command or reviewRequest.instruction configured");
  }
  if (command) await runReviewCommand(command, ref, target);
  if (instruction) {
    const variables = { ...target, repo: ref.repo, number: String(ref.number) };
    print(`Review request instruction: ${fillTemplate(instruction, variables)}`);
  }
  await recordReviewRequest(paths, ref, target.head);
  print(`recorded review request for ${formatPullRequest(ref)} at ${shortSha(target.head)}`);
}
