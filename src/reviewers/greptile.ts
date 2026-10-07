import type { ReviewerParser } from "./types.ts";

const SUMMARY_MARKER = "<!-- greptile_summary -->";
const FOOTER_MARKER = "<sub>";
const HIDDEN_SCORE = /greptile_confidence_score:(\d+)/u;
const VISIBLE_SCORE = /Confidence Score:\s*(\d+)\s*\/\s*(\d+)/u;
const REVIEWED_COMMIT = /commit\/([0-9a-fA-F]{40})/u;
const REVIEW_COUNT = /Reviews \((\d+)\)/u;
const DEFAULT_MAX_SCORE = 5;

function numberAt(match: RegExpExecArray | null, group: number) {
  const captured = match?.[group];
  return captured === undefined ? null : Number(captured);
}

function maxScoreOf(visible: RegExpExecArray | null, score: number | null) {
  if (visible) return numberAt(visible, 2);
  return score === null ? null : DEFAULT_MAX_SCORE;
}

export const greptile: ReviewerParser = {
  id: "greptile",
  defaultLogins: ["greptile-apps"],
  parse(comment) {
    const { body } = comment;
    if (!body.includes(SUMMARY_MARKER)) return null;
    const visible = VISIBLE_SCORE.exec(body);
    const score = numberAt(HIDDEN_SCORE.exec(body), 1) ?? numberAt(visible, 1);
    const footer = body.slice(Math.max(body.lastIndexOf(FOOTER_MARKER), 0));
    return {
      score,
      maxScore: maxScoreOf(visible, score),
      reviewedSha: REVIEWED_COMMIT.exec(footer)?.[1]?.toLowerCase() ?? null,
      reviewsCount: numberAt(REVIEW_COUNT.exec(footer), 1),
      commentId: comment.id,
    };
  },
};
