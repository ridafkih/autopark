import type { ReviewerParser } from "./types.ts";

const SUMMARY = "<!-- greptile_summary -->";
const HIDDEN = /greptile_confidence_score:(\d+)/;
const VISIBLE = /Confidence Score:\s*(\d+)\s*\/\s*(\d+)/;
const COMMIT = /commit\/([0-9a-fA-F]{40})/;
const REVIEWS = /Reviews \((\d+)\)/;

export const greptile: ReviewerParser = {
  id: "greptile",
  defaultLogins: ["greptile-apps"],
  parse(comment) {
    const body = comment.body;
    if (!body.includes(SUMMARY)) return null;
    const hidden = HIDDEN.exec(body);
    const visible = VISIBLE.exec(body);
    const score = hidden ? Number(hidden[1]) : visible ? Number(visible[1]) : null;
    const maxScore = visible ? Number(visible[2]) : score === null ? null : 5;
    const footer = body.slice(body.lastIndexOf("<sub>") >= 0 ? body.lastIndexOf("<sub>") : 0);
    const commit = COMMIT.exec(footer);
    const reviews = REVIEWS.exec(footer);
    return {
      score,
      maxScore,
      reviewedSha: commit ? commit[1]!.toLowerCase() : null,
      reviewsCount: reviews ? Number(reviews[1]) : null,
      commentId: comment.id,
    };
  },
};
