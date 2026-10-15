import { parseArgs } from "node:util";
import type { Paths } from "../../daemon/paths.ts";
import { trackedSummary } from "../daemon-api.ts";
import { fetchEvaluation } from "../evaluation.ts";
import { print } from "../output.ts";
import { projectContext, resolveRef } from "../project.ts";
import type { PullRequestRef } from "../ref.ts";
import { formatCheckReport, type RecordedRequest } from "./check-report.ts";
import type { Invocation } from "./types.ts";

async function recordedRequest(
  ref: PullRequestRef,
  paths: Paths,
  when: RecordedRequest["when"],
): Promise<RecordedRequest | null> {
  const summary = await trackedSummary(paths, ref);
  if (!summary) return null;
  return { head: summary.reviewRequestedHead, ready: summary.reviewRequestedReady ?? null, when };
}

export async function checkPullRequest({ argv, paths }: Invocation) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: "boolean" } },
  });
  const { config } = await projectContext();
  const ref = await resolveRef(positionals[0], config);
  const fetched = await fetchEvaluation(ref, paths);
  const { evaluation, cost, reads } = fetched;
  if (values.json) {
    print(JSON.stringify(evaluation, null, 2));
    return;
  }
  const request = await recordedRequest(ref, paths, fetched.config.reviewRequest.when);
  print(formatCheckReport(evaluation, { cost, reads }, request));
}
