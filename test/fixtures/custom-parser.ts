import type { ReviewerParser } from "../../src/reviewers/types.ts";

const SCORE = /SCORE (\d+)/u;

const parser: ReviewerParser = {
  id: "custom",
  defaultLogins: [],
  parse(comment) {
    const [, score] = SCORE.exec(comment.body) ?? [];
    if (score === undefined) return null;
    return {
      score: Number(score),
      maxScore: 10,
      reviewedSha: null,
      reviewsCount: null,
      commentId: comment.id,
    };
  },
};

export default parser;
