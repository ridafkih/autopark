import { parseArgs } from "node:util";
import { formatSummaries, type PullRequestSummary } from "../../core/summary.ts";
import { loadStatus } from "../daemon-api.ts";
import { print } from "../output.ts";
import type { Invocation } from "./types.ts";

const STATUS_OPTIONS = {
  json: { type: "boolean" },
  session: { type: "string" },
  repo: { type: "string" },
} as const;

const matchesSession = (session: string | undefined) => (summary: PullRequestSummary) =>
  !session || summary.sessionId === session;

const matchesRepo = (repo: string | undefined) => (summary: PullRequestSummary) =>
  !repo || summary.repo.toLowerCase() === repo.toLowerCase();

export async function showStatus({ argv, paths }: Invocation) {
  const { values } = parseArgs({ args: argv, options: STATUS_OPTIONS });
  const report = await loadStatus(paths);
  const pullRequests = report.pullRequests
    .filter(matchesSession(values.session))
    .filter(matchesRepo(values.repo));
  if (values.json) {
    print(JSON.stringify({ daemon: report.daemon, prs: pullRequests }, null, 2));
    return;
  }
  print(formatSummaries(pullRequests, report.daemon, Date.now()));
}
