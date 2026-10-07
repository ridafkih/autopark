import { TRANSITION_KINDS } from "../core/types.ts";
import { arraySchema, nullableSchema, objectSchema, recordSchema } from "./dsl/collections.ts";
import { booleanSchema, enumSchema, numberSchema, stringSchema } from "./dsl/scalars.ts";

export const repoSlug = stringSchema({
  pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  description: "owner/name",
});
const strings = (description: string, defaultValue: string[] = []) =>
  arraySchema(stringSchema({ minLength: 1 }), { default: defaultValue, description });

export const reviewerSchema = objectSchema({
  name: stringSchema({
    pattern: /^[a-z0-9][a-z0-9_-]*$/u,
    description: "Identifier used in transitions and status",
  }),
  parser: stringSchema({
    minLength: 1,
    description: "Built-in parser id (greptile, regex) or a module path",
  }),
  logins: strings(
    "Author logins whose comments the parser reads; empty means the parser's defaults",
  ),
  minScore: nullableSchema(numberSchema({}), {
    default: null,
    description: "Minimum score for readiness; null disables the threshold",
  }),
  required: booleanSchema({
    default: true,
    description: "Block readiness until this reviewer has scored the head",
  }),
  requireOnHead: booleanSchema({
    default: true,
    description: "Only count a score whose reviewed commit equals the PR head",
  }),
  options: recordSchema({ default: {}, description: "Parser-specific options" }),
});

export const notifyTargetSchema = objectSchema({
  type: enumSchema(["command"] as const),
  command: stringSchema({
    minLength: 1,
    description: "Shell command; transition fields arrive as AUTOPARK_* env vars and JSON on stdin",
  }),
  on: arraySchema(enumSchema(TRANSITION_KINDS), {
    default: ["ready", "conflicted", "checks_failed", "merged"],
  }),
});

export const trackSection = objectSchema({
  authors: strings("Auto-track PRs by these authors; @me is the authenticated user"),
  branchPrefixes: strings("Auto-track PRs whose head branch starts with one of these"),
  labels: strings("Auto-track PRs carrying any of these labels"),
});

export const checksSection = objectSchema({
  useGitHubRequired: booleanSchema({
    default: true,
    description: "Treat checks GitHub marks required (branch protection/rulesets) as required",
  }),
  required: strings("Extra required check names; a missing one counts as pending"),
  humanGates: strings("Checks that wait on a human; never treated as failures"),
  ignore: strings("Check names to ignore entirely"),
});

export const readinessSection = objectSchema({
  noUnresolvedThreads: booleanSchema({ default: true }),
  countOutdatedThreads: booleanSchema({
    default: true,
    description: "Outdated but unresolved threads still block",
  }),
  approvalOnHead: booleanSchema({
    default: true,
    description: "Require an approval whose commit is the current head",
  }),
  minApprovals: numberSchema({ default: 1, min: 0, int: true }),
  noConflict: booleanSchema({ default: true }),
  requiredChecksPass: booleanSchema({ default: true }),
  allowDraft: booleanSchema({ default: false }),
  baseFreshness: objectSchema({
    policy: enumSchema(["off", "contains-tip", "max-behind", "paths"] as const, {
      default: "off",
      description:
        "contains-tip: head must contain the base tip; max-behind: base may be ahead by at most maxBehind commits; paths: base changes since the merge base must not touch `paths`",
    }),
    maxBehind: numberSchema({ default: 0, min: 0, int: true }),
    paths: strings("Globs used by the paths policy"),
  }),
});

export const autoMergeSection = objectSchema({
  default: booleanSchema({
    default: false,
    description: "Auto-merge every tracked PR once mergeable",
  }),
  labels: strings("PRs with any of these labels auto-merge"),
  method: enumSchema(["merge", "squash", "rebase"] as const, { default: "squash" }),
  command: nullableSchema(stringSchema({ minLength: 1 }), {
    default: null,
    description: "Custom merge command; overrides the built-in merge",
  }),
});

export const reviewRequestSection = objectSchema({
  command: nullableSchema(stringSchema({ minLength: 1 }), {
    default: null,
    description: "Command run by `autopark request-review`",
  }),
  instruction: nullableSchema(stringSchema({ minLength: 1 }), {
    default: null,
    description:
      "Text handed to Claude to request review with its own tools; {repo} {number} {url} {title} {head} are substituted",
  }),
});

export const standardsSection = objectSchema({
  files: strings("Files /ship reads before implementing", ["CLAUDE.md", "AGENTS.md"]),
  skills: strings("Skills /ship loads before implementing"),
  prBodyTemplate: nullableSchema(stringSchema({ minLength: 1 }), {
    default: null,
    description: "Path to a PR body template",
  }),
});

export const deliverySection = objectSchema({
  channel: booleanSchema({
    default: true,
    description: "Push transitions into the session through the plugin's channel server",
  }),
  monitor: enumSchema(["auto", "always", "off"] as const, {
    default: "auto",
    description:
      "Plugin monitor fallback; auto stays silent when the session loaded the autopark channel",
  }),
  playbook: nullableSchema(stringSchema({ minLength: 1 }), {
    default: null,
    description:
      "Path (relative to this file) to a playbook that replaces the bundled autopark skill",
  }),
});

export const hooksSection = objectSchema({
  sessionStart: objectSchema({ enabled: booleanSchema({ default: true }) }),
  stop: objectSchema({
    enabled: booleanSchema({ default: true }),
    scope: enumSchema(["session", "repo", "all"] as const, { default: "session" }),
    maxBlocks: numberSchema({ default: 3, min: 1, max: 8, int: true }),
    blockOnConflict: booleanSchema({ default: true }),
    blockOnStaleBase: booleanSchema({ default: true }),
    blockOnFailedChecks: booleanSchema({ default: true }),
    blockOnReviewFindings: booleanSchema({ default: true }),
    blockOnHeadMovedWithoutReview: booleanSchema({ default: false }),
  }),
});

export const daemonSection = objectSchema({
  source: objectSchema({
    type: stringSchema({
      minLength: 1,
      default: "gh-webhook-forward",
      description: "Event-source adapter id",
    }),
    options: recordSchema({ default: {} }),
  }),
  port: numberSchema({
    default: 8787,
    min: 1,
    max: 65535,
    int: true,
    description: "Local webhook receiver port",
  }),
  secretEnv: stringSchema({
    default: "AUTOPARK_WEBHOOK_SECRET",
    description: "Env var holding the webhook secret; an ephemeral one is generated if unset",
  }),
  debounceMs: numberSchema({ default: 500, min: 0, int: true }),
  backoffMs: arraySchema(numberSchema({ min: 0, int: true }), {
    default: [1000, 2000, 4000, 8000, 16000, 30000],
    minItems: 1,
  }),
});
