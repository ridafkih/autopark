import { describe, expect, test } from "bun:test";
import { greptile } from "../src/reviewers/greptile.ts";
import { regexParser } from "../src/reviewers/regex.ts";
import { loadParsers, loginMatches } from "../src/reviewers/index.ts";
import { greptileSummary, SHA_A, SHA_B } from "./fixtures/greptile.ts";
import type { PrComment, ReviewerResult } from "../src/core/types.ts";

const comment = (body: string, author = "greptile-apps"): PrComment => ({
  id: "c1",
  author,
  body,
  updatedAt: "2026-10-06T00:00:00Z",
});

const greptileCases: Array<[string, string, Partial<ReviewerResult> | null]> = [
  [
    "hidden marker, visible header and footer agree",
    greptileSummary({ score: 5, reviews: 3, sha: SHA_A }),
    { score: 5, maxScore: 5, reviewedSha: SHA_A, reviewsCount: 3 },
  ],
  [
    "hidden marker only",
    greptileSummary({ visibleScore: null, hiddenScore: 4, sha: SHA_B }),
    { score: 4, reviewedSha: SHA_B },
  ],
  [
    "visible fallback when the hidden marker is missing",
    greptileSummary({ visibleScore: 3, hiddenScore: null }),
    { score: 3, maxScore: 5 },
  ],
  [
    "hidden marker wins when the two disagree",
    greptileSummary({ visibleScore: 2, hiddenScore: 4 }),
    { score: 4 },
  ],
  ["score zero is a real score", greptileSummary({ score: 0 }), { score: 0 }],
  [
    "no footer leaves the reviewed commit unknown",
    greptileSummary({ score: 5, sha: null }),
    { score: 5, reviewedSha: null, reviewsCount: null },
  ],
  ["multi-digit review count", greptileSummary({ reviews: 12 }), { reviewsCount: 12 }],
  [
    "uppercase sha in footer is normalised",
    greptileSummary({ sha: SHA_A.toUpperCase() }),
    { reviewedSha: SHA_A },
  ],
  [
    "summary without any score",
    greptileSummary({ visibleScore: null, hiddenScore: null }),
    { score: null, reviewedSha: SHA_A },
  ],
  ["comment that is not a greptile summary", "Looks good to me! Confidence Score: 5/5", null],
  ["empty body", "", null],
];

describe("greptile parser", () => {
  test.each(greptileCases)("%s", (_label, body, expected) => {
    const r = greptile.parse(comment(body), {});
    if (expected === null) {
      expect(r).toBeNull();
      return;
    }
    expect(r).not.toBeNull();
    expect(r).toMatchObject(expected);
    expect(r!.commentId).toBe("c1");
  });

  test("default logins cover the GraphQL and webhook spellings", () => {
    expect(loginMatches("greptile-apps", greptile.defaultLogins)).toBe(true);
    expect(loginMatches("greptile-apps[bot]", greptile.defaultLogins)).toBe(true);
    expect(loginMatches("someone-else", greptile.defaultLogins)).toBe(false);
  });
});

const rabbitOptions = {
  marker: "<!-- rabbit-review -->",
  score: "Score: (\\d+)/(\\d+)",
  reviewedCommit: "Reviewed commit ([0-9a-f]{7,40})",
  reviewsCount: "Pass (\\d+)",
};

const regexCases: Array<[string, Record<string, unknown>, string, Partial<ReviewerResult> | null]> =
  [
    [
      "score with max from the second group",
      rabbitOptions,
      "<!-- rabbit-review -->\nScore: 4/5\nReviewed commit abc1234\nPass 2",
      { score: 4, maxScore: 5, reviewedSha: "abc1234", reviewsCount: 2 },
    ],
    ["marker missing", rabbitOptions, "Score: 4/5", null],
    [
      "no marker configured matches any body",
      { score: "rating=(\\d+)" },
      "rating=7",
      { score: 7, maxScore: null, reviewedSha: null },
    ],
    [
      "fixed maxScore option",
      { score: "rating=(\\d+)", maxScore: 10 },
      "rating=7",
      { score: 7, maxScore: 10 },
    ],
    ["score absent", rabbitOptions, "<!-- rabbit-review -->\nnothing here", { score: null }],
  ];

describe("regex parser", () => {
  test.each(regexCases)("%s", (_label, options, body, expected) => {
    const r = regexParser.parse(comment(body, "rabbit"), options);
    if (expected === null) return expect(r).toBeNull();
    expect(r).toMatchObject(expected);
  });

  test("rejects options without a score pattern", () => {
    expect(() => regexParser.validate!({})).toThrow(/score/);
  });
});

describe("parser registry", () => {
  test("resolves built-ins by id", async () => {
    const parsers = await loadParsers([
      {
        name: "greptile",
        parser: "greptile",
        logins: [],
        minScore: 5,
        required: true,
        requireOnHead: true,
        options: {},
      },
      {
        name: "rabbit",
        parser: "regex",
        logins: ["rabbit"],
        minScore: null,
        required: false,
        requireOnHead: false,
        options: { score: "(\\d+)" },
      },
    ]);
    expect(parsers.get("greptile")?.id).toBe("greptile");
    expect(parsers.get("rabbit")?.id).toBe("regex");
  });

  test("loads a custom parser module by path", async () => {
    const parsers = await loadParsers(
      [
        {
          name: "custom",
          parser: "./fixtures/custom-parser.ts",
          logins: ["bot"],
          minScore: null,
          required: true,
          requireOnHead: true,
          options: {},
        },
      ],
      import.meta.dir,
    );
    const p = parsers.get("custom")!;
    expect(p.parse(comment("SCORE 9", "bot"), {})).toMatchObject({ score: 9 });
  });

  test("unknown parser id fails loudly", async () => {
    await expect(
      loadParsers([
        {
          name: "x",
          parser: "nope",
          logins: [],
          minScore: null,
          required: true,
          requireOnHead: true,
          options: {},
        },
      ]),
    ).rejects.toThrow(/nope/);
  });
});
