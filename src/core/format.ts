import type { PullRequestLocator } from "./types.ts";

const SHORT_SHA_LENGTH = 7;

interface Score {
  score: number | null;
  maxScore: number | null;
}

export const shortSha = (sha: string, length = SHORT_SHA_LENGTH) => sha.slice(0, length);

export const formatScore = ({ score, maxScore }: Score) =>
  maxScore ? `${score}/${maxScore}` : `${score}`;

export const formatPullRequest = ({ repo, number }: PullRequestLocator) => `${repo}#${number}`;

export const pullRequestUrl = ({ repo, number }: PullRequestLocator) =>
  `https://github.com/${repo}/pull/${number}`;

export const listOrNone = (names: string[]) => names.join(", ") || "none";

export const formatFailedChecks = (checks: Array<{ name: string; conclusion: string }>) =>
  checks.map((check) => `${check.name} (${check.conclusion})`).join(", ");
