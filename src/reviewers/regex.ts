import { isNumber, isString } from "../core/json.ts";
import type { ReviewerParser } from "./types.ts";

interface RegexOptions {
  marker?: string;
  score: string;
  maxScore?: number;
  reviewedCommit?: string;
  reviewsCount?: string;
}

const optionalString = (value: unknown) => (isString(value) ? value : undefined);

function readOptions(options: Record<string, unknown>): RegexOptions {
  const { score, marker, maxScore, reviewedCommit, reviewsCount } = options;
  if (!isString(score)) {
    throw new TypeError(
      "regex parser needs options.score (a pattern whose first group is the score)",
    );
  }
  return {
    score,
    marker: optionalString(marker),
    maxScore: isNumber(maxScore) ? maxScore : undefined,
    reviewedCommit: optionalString(reviewedCommit),
    reviewsCount: optionalString(reviewsCount),
  };
}

const compilePattern = (pattern: string) => new RegExp(pattern);

function captured(pattern: string | undefined, body: string, group = 1) {
  if (!pattern) return null;
  return new RegExp(pattern, "m").exec(body)?.[group] ?? null;
}

function maxScoreOf(capturedMax: string | null, configured: number | undefined) {
  if (capturedMax !== null) return Number(capturedMax);
  return typeof configured === "number" ? configured : null;
}

const toNumber = (value: string | null) => (value === null ? null : Number(value));

export const regexParser: ReviewerParser = {
  id: "regex",
  defaultLogins: [],
  validate(options) {
    const { score, reviewedCommit, reviewsCount } = readOptions(options);
    for (const pattern of [score, reviewedCommit, reviewsCount]) {
      if (pattern) compilePattern(pattern);
    }
  },
  parse(comment, options) {
    const regexOptions = readOptions(options);
    const { body } = comment;
    if (regexOptions.marker && !body.includes(regexOptions.marker)) return null;
    const sha = captured(regexOptions.reviewedCommit, body);
    return {
      score: toNumber(captured(regexOptions.score, body)),
      maxScore: maxScoreOf(captured(regexOptions.score, body, 2), regexOptions.maxScore),
      reviewedSha: sha ? sha.toLowerCase() : null,
      reviewsCount: toNumber(captured(regexOptions.reviewsCount, body)),
      commentId: comment.id,
    };
  },
};
