import { parseConfig, type Config } from "../../src/config/schema.ts";
import type { CheckContext, Snapshot } from "../../src/core/types.ts";
import { greptileSummary } from "./greptile.ts";

export const HEAD = "1111111111111111111111111111111111111111";
export const HEAD2 = "2222222222222222222222222222222222222222";
export const OLD = "0000000000000000000000000000000000000000";
export const REPO = "acme/widgets";
export const BASE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export function config(overrides: Record<string, unknown> = {}): Config {
  const result = parseConfig({
    repos: [REPO],
    track: { authors: ["octo"], branchPrefixes: ["bot/"] },
    checks: {
      useGitHubRequired: true,
      required: ["build"],
      humanGates: ["gate"],
      ignore: ["noise"],
    },
    reviewers: [{ name: "greptile", parser: "greptile", minScore: 4 }],
    daemon: { debounceMs: 0 },
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.config;
}

const CONCLUSIONS: Record<CheckContext["outcome"], string> = {
  pass: "SUCCESS",
  fail: "FAILURE",
  pending: "IN_PROGRESS",
};

export const check = (
  name: string,
  outcome: CheckContext["outcome"],
  extra: Partial<CheckContext> = {},
): CheckContext => ({
  name,
  kind: "check",
  outcome,
  conclusion: CONCLUSIONS[outcome],
  isRequired: false,
  app: "github-actions",
  url: `https://ci.invalid/${name}`,
  ...extra,
});

const SECONDS_DIGITS = 10;

export const greptileComment = (score: number, sha: string, reviews = 1, id = "g1") => ({
  id,
  author: "greptile-apps",
  body: greptileSummary({ score, sha, reviews }),
  updatedAt: `2026-10-06T00:00:0${reviews % SECONDS_DIGITS}Z`,
});

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const headSha = overrides.headSha ?? HEAD;
  return {
    repo: REPO,
    number: 7,
    title: "Tidy the widget loader",
    url: `https://github.com/${REPO}/pull/7`,
    state: "OPEN",
    isDraft: false,
    author: "octo",
    headRef: "bot/tidy",
    baseRef: "main",
    headSha,
    baseSha: BASE,
    baseComparison: { behindBy: 0, files: [], truncated: false },
    labels: [],
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checks: [
      check("build", "pass"),
      check("lint", "pass"),
      check("gate", "pass", { isRequired: true }),
    ],
    approvals: [{ login: "reviewer", state: "APPROVED", sha: headSha }],
    threads: [],
    comments: [greptileComment(5, headSha)],
    ...overrides,
  };
}
