import type { PrComment, ReviewerResult } from "../core/types.ts";

export interface ReviewerParser {
  id: string;
  defaultLogins: string[];
  parse(comment: PrComment, options: Record<string, unknown>): ReviewerResult | null;
  validate?(options: Record<string, unknown>): void;
}
