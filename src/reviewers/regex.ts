import type { ReviewerParser } from "./types.ts";

type Options = { marker?: string; score: string; maxScore?: number; reviewedCommit?: string; reviewsCount?: string };

function read(options: Record<string, unknown>): Options {
  if (typeof options.score !== "string") throw new Error("regex parser needs options.score (a pattern whose first group is the score)");
  return options as unknown as Options;
}

const group = (pattern: string | undefined, body: string, n = 1) => {
  if (!pattern) return null;
  const m = new RegExp(pattern, "m").exec(body);
  return m?.[n] ?? null;
};

export const regexParser: ReviewerParser = {
  id: "regex",
  defaultLogins: [],
  validate(options) {
    const o = read(options);
    for (const p of [o.score, o.reviewedCommit, o.reviewsCount]) if (p) new RegExp(p);
  },
  parse(comment, options) {
    const o = read(options);
    if (o.marker && !comment.body.includes(o.marker)) return null;
    const score = group(o.score, comment.body);
    const max = group(o.score, comment.body, 2);
    const reviews = group(o.reviewsCount, comment.body);
    const sha = group(o.reviewedCommit, comment.body);
    return {
      score: score === null ? null : Number(score),
      maxScore: max !== null ? Number(max) : typeof o.maxScore === "number" ? o.maxScore : null,
      reviewedSha: sha ? sha.toLowerCase() : null,
      reviewsCount: reviews === null ? null : Number(reviews),
      commentId: comment.id,
    };
  },
};
