import { anyRecord, arr, bool, nullable, num, obj, oneOf, str, type Issue, type Schema } from "./dsl.ts";
import { TRANSITION_KINDS } from "../core/types.ts";

const repoSlug = str({ pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, description: "owner/name" });
const strings = (description: string, def: string[] = []) => arr(str({ minLength: 1 }), { default: def, description });

const reviewer = obj({
  name: str({ pattern: /^[a-z0-9][a-z0-9_-]*$/, description: "Identifier used in transitions and status" }),
  parser: str({ minLength: 1, description: "Built-in parser id (greptile, regex) or a module path" }),
  logins: strings("Author logins whose comments the parser reads; empty means the parser's defaults"),
  minScore: nullable(num({}), { default: null, description: "Minimum score for readiness; null disables the threshold" }),
  required: bool({ default: true, description: "Block readiness until this reviewer has scored the head" }),
  requireOnHead: bool({ default: true, description: "Only count a score whose reviewed commit equals the PR head" }),
  options: anyRecord({ default: {}, description: "Parser-specific options" }),
});

const notifyTarget = obj({
  type: oneOf(["command"] as const),
  command: str({ minLength: 1, description: "Shell command; transition fields arrive as PR_AUTOPILOT_* env vars and JSON on stdin" }),
  on: arr(oneOf(TRANSITION_KINDS), { default: ["ready", "conflicted", "checks_failed", "merged"] }),
});

export const configSchema = obj({
  repos: arr(repoSlug, { minItems: 1, description: "Repositories this project tracks" }),
  track: obj({
    authors: strings("Auto-track PRs by these authors; @me is the authenticated user"),
    branchPrefixes: strings("Auto-track PRs whose head branch starts with one of these"),
    labels: strings("Auto-track PRs carrying any of these labels"),
  }),
  checks: obj({
    useGitHubRequired: bool({ default: true, description: "Treat checks GitHub marks required (branch protection/rulesets) as required" }),
    required: strings("Extra required check names; a missing one counts as pending"),
    humanGates: strings("Checks that wait on a human; never treated as failures"),
    ignore: strings("Check names to ignore entirely"),
  }),
  reviewers: arr(reviewer, { default: [] }),
  readiness: obj({
    noUnresolvedThreads: bool({ default: true }),
    countOutdatedThreads: bool({ default: true, description: "Outdated but unresolved threads still block" }),
    approvalOnHead: bool({ default: true, description: "Require an approval whose commit is the current head" }),
    minApprovals: num({ default: 1, min: 0, int: true }),
    noConflict: bool({ default: true }),
    requiredChecksPass: bool({ default: true }),
    allowDraft: bool({ default: false }),
    baseFreshness: obj({
      policy: oneOf(["off", "contains-tip", "max-behind", "paths"] as const, {
        default: "off",
        description: "contains-tip: head must contain the base tip; max-behind: base may be ahead by at most maxBehind commits; paths: base changes since the merge base must not touch `paths`",
      }),
      maxBehind: num({ default: 0, min: 0, int: true }),
      paths: strings("Globs used by the paths policy"),
    }),
  }),
  notify: arr(notifyTarget, { default: [] }),
  autoMerge: obj({
    default: bool({ default: false, description: "Auto-merge every tracked PR once mergeable" }),
    labels: strings("PRs with any of these labels auto-merge"),
    method: oneOf(["merge", "squash", "rebase"] as const, { default: "squash" }),
    command: nullable(str({ minLength: 1 }), { default: null, description: "Custom merge command; overrides the built-in merge" }),
  }),
  reviewRequest: obj({
    command: nullable(str({ minLength: 1 }), { default: null, description: "Command run by `pr-autopilot request-review`" }),
    instruction: nullable(str({ minLength: 1 }), {
      default: null,
      description: "Text handed to Claude to request review with its own tools; {repo} {number} {url} {title} {head} are substituted",
    }),
  }),
  standards: obj({
    files: strings("Files /ship reads before implementing", ["CLAUDE.md", "AGENTS.md"]),
    skills: strings("Skills /ship loads before implementing"),
    prBodyTemplate: nullable(str({ minLength: 1 }), { default: null, description: "Path to a PR body template" }),
  }),
  delivery: obj({
    channel: bool({ default: true }),
    monitor: bool({ default: true }),
  }),
  hooks: obj({
    sessionStart: obj({ enabled: bool({ default: true }) }),
    stop: obj({
      enabled: bool({ default: true }),
      scope: oneOf(["session", "repo", "all"] as const, { default: "session" }),
      maxBlocks: num({ default: 3, min: 1, max: 8, int: true }),
      blockOnConflict: bool({ default: true }),
      blockOnStaleBase: bool({ default: true }),
      blockOnFailedChecks: bool({ default: true }),
      blockOnReviewFindings: bool({ default: true }),
      blockOnHeadMovedWithoutReview: bool({ default: false }),
    }),
  }),
  daemon: obj({
    source: obj({
      type: str({ minLength: 1, default: "gh-webhook-forward", description: "Event-source adapter id" }),
      options: anyRecord({ default: {} }),
    }),
    port: num({ default: 8787, min: 1, max: 65535, int: true, description: "Local webhook receiver port" }),
    secretEnv: str({ default: "PR_AUTOPILOT_WEBHOOK_SECRET", description: "Env var holding the webhook secret; an ephemeral one is generated if unset" }),
    debounceMs: num({ default: 500, min: 0, int: true }),
    backoffMs: arr(num({ min: 0, int: true }), { default: [1000, 2000, 4000, 8000, 16000, 30000], minItems: 1 }),
  }),
});

export type Config = typeof configSchema extends Schema<infer T> ? T : never;
export type ReviewerConfig = Config["reviewers"][number];

export type ParseResult = { ok: true; config: Config } | { ok: false; issues: Issue[] };

export function parseConfig(input: unknown): ParseResult {
  const issues: Issue[] = [];
  const config = configSchema.parse(input, "", issues);
  return issues.length ? { ok: false, issues } : { ok: true, config };
}

export function configJsonSchema() {
  return { $schema: "https://json-schema.org/draft/2020-12/schema", title: "pr-autopilot config", ...configSchema.json() };
}

export function defaultConfig(repos: string[]): Config {
  const r = parseConfig({ repos });
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return r.config;
}
