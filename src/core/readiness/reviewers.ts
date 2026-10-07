import type { ReviewerConfig } from "../../config/schema.ts";
import { loginMatches } from "../../reviewers/index.ts";
import type { ReviewerParser } from "../../reviewers/types.ts";
import { shaMatches } from "../sha.ts";
import type { PullRequestComment, ReviewerEvaluation, ReviewerResult, Snapshot } from "../types.ts";

interface ScoredComment {
  result: ReviewerResult;
  updatedAt: string;
}

const NO_RESULT: ReviewerResult = {
  score: null,
  maxScore: null,
  reviewedSha: null,
  reviewsCount: null,
  commentId: null,
};

function latestScore(
  comments: PullRequestComment[],
  reviewer: ReviewerConfig,
  parser: ReviewerParser,
): ScoredComment | null {
  const logins = reviewer.logins.length > 0 ? reviewer.logins : parser.defaultLogins;
  return comments
    .filter((comment) => logins.length === 0 || loginMatches(comment.author, logins))
    .reduce<ScoredComment | null>((latest, comment) => {
      const result = parser.parse(comment, reviewer.options);
      if (!result || (latest && comment.updatedAt < latest.updatedAt)) return latest;
      return { result, updatedAt: comment.updatedAt };
    }, null);
}

function evaluateReviewer(
  snapshot: Snapshot,
  reviewer: ReviewerConfig,
  parser: ReviewerParser | undefined,
): ReviewerEvaluation {
  const latest = parser ? latestScore(snapshot.comments, reviewer, parser) : null;
  const result = latest?.result ?? NO_RESULT;
  const isOnHead = !reviewer.requireOnHead || shaMatches(result.reviewedSha, snapshot.headSha);
  const isThresholdMet =
    result.score !== null && (reviewer.minScore === null || result.score >= reviewer.minScore);
  return {
    ...result,
    name: reviewer.name,
    present: latest !== null,
    onHead: isOnHead,
    required: reviewer.required,
    minScore: reviewer.minScore,
    meetsThreshold: isThresholdMet,
  };
}

export function evaluateReviewers(
  snapshot: Snapshot,
  reviewers: ReviewerConfig[],
  parsers: Map<string, ReviewerParser>,
) {
  return reviewers.map((reviewer) =>
    evaluateReviewer(snapshot, reviewer, parsers.get(reviewer.name)),
  );
}
