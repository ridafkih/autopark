import { arraySchema, objectSchema } from "./dsl/collections.ts";
import type { Issue, Schema } from "./dsl/core.ts";
import {
  autoMergeSection,
  checksSection,
  daemonSection,
  deliverySection,
  hooksSection,
  notifyTargetSchema,
  readinessSection,
  repoSlug,
  reviewerSchema,
  reviewRequestSection,
  standardsSection,
  trackSection,
} from "./sections.ts";

export const configSchema = objectSchema({
  repos: arraySchema(repoSlug, { minItems: 1, description: "Repositories this project tracks" }),
  track: trackSection,
  checks: checksSection,
  reviewers: arraySchema(reviewerSchema, { default: [] }),
  readiness: readinessSection,
  notify: arraySchema(notifyTargetSchema, { default: [] }),
  autoMerge: autoMergeSection,
  reviewRequest: reviewRequestSection,
  standards: standardsSection,
  delivery: deliverySection,
  hooks: hooksSection,
  daemon: daemonSection,
});

export type Config = typeof configSchema extends Schema<infer Parsed> ? Parsed : never;
export type ReviewerConfig = Config["reviewers"][number];

export type ParseResult = { ok: true; config: Config } | { ok: false; issues: Issue[] };

export const formatIssue = (issue: Issue) => `${issue.path}: ${issue.message}`;

export function parseConfig(input: unknown): ParseResult {
  const issues: Issue[] = [];
  const config = configSchema.parse(input, "", issues);
  if (config === undefined || issues.length > 0) return { ok: false, issues };
  return { ok: true, config };
}

export function configJsonSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "autopark config",
    ...configSchema.json(),
  };
}

export function defaultConfig(repos: string[]): Config {
  const result = parseConfig({ repos });
  if (!result.ok) throw new Error(result.issues.map(formatIssue).join("; "));
  return result.config;
}
