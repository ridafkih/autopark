import type { ReviewerParser } from "../../src/reviewers/types.ts";

const parser: ReviewerParser = {
  id: "custom",
  defaultLogins: [],
  parse(comment) {
    const m = /SCORE (\d+)/.exec(comment.body);
    if (!m) return null;
    return { score: Number(m[1]), maxScore: 10, reviewedSha: null, reviewsCount: null, commentId: comment.id };
  },
};

export default parser;
