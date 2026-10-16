import {
  isEarlyRequest,
  isReviewableForRequest,
  type ReviewRequestTiming,
} from "../../core/approval-request.ts";
import { formatPullRequest, shortSha } from "../../core/format.ts";
import { fillTemplate } from "../../core/template.ts";
import { pullRequestKey } from "../../core/types.ts";
import { transitionEnv } from "../../daemon/notify.ts";
import { shellRunner } from "../../daemon/runner.ts";
import { callDaemon, trackedSummary, withOfflineStore } from "../daemon-api.ts";
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
  ready: boolean;
}

async function reviewTarget(ref: PullRequestRef, paths: Paths): Promise<ReviewTarget> {
  const summary = await trackedSummary(paths, ref);
  if (summary?.head) {
    const { head, title, url, state, reasons } = summary;
    const isOpen = state !== "merged" && state !== "closed";
    return { head, title, url, ready: isReviewableForRequest(isOpen, reasons) };
  }
  const { evaluation } = await fetchEvaluation(ref, paths);
  const { headSha, title, url, state, reasons } = evaluation;
  return { head: headSha, title, url, ready: isReviewableForRequest(state === "OPEN", reasons) };
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

async function recordReviewRequest(paths: Paths, ref: PullRequestRef, target: ReviewTarget) {
  const { head, ready } = target;
  if (await callDaemon(paths, "POST", "/review-requested", { ...ref, head, ready })) return;
  withOfflineStore(paths, (store) =>
    store.setReviewRequested(pullRequestKey(ref.repo, ref.number), head, ready),
  );
}

function recordedLine(ref: PullRequestRef, target: ReviewTarget, when: ReviewRequestTiming) {
  const recorded = `recorded review request for ${formatPullRequest(ref)} at ${shortSha(target.head)}`;
  if (!isEarlyRequest(target, when)) return recorded;
  return `${recorded}; requested early (draft/not reviewable), will re-ask when reviewable`;
}

export async function requestReview({ argv, paths }: Invocation) {
  const { config: localConfig } = await projectContext();
  const ref = await resolveRef(argv[0], localConfig);
  const { config } = await configFor(ref.repo, paths);
  const target = await reviewTarget(ref, paths);
  const { command, instruction, when } = config.reviewRequest;
  if (!command && !instruction) {
    throw new CliError("no reviewRequest.command or reviewRequest.instruction configured");
  }
  if (command) await runReviewCommand(command, ref, target);
  if (instruction) {
    const { head, title, url } = target;
    const variables = { head, title, url, repo: ref.repo, number: String(ref.number) };
    print(`Review request instruction: ${fillTemplate(instruction, variables)}`);
  }
  await recordReviewRequest(paths, ref, target);
  print(recordedLine(ref, target, when));
}
