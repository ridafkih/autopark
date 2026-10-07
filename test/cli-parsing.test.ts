import { describe, expect, test } from "bun:test";
import { scopesFrom } from "../src/cli/doctor/environment.ts";
import { parseRef, repoFromRemote } from "../src/cli/ref.ts";

describe("parseRef", () => {
  test.each([
    ["owner/repo#n", "acme/widgets#12", null, { repo: "acme/widgets", number: 12 }],
    [
      "PR url",
      "https://github.com/acme/widgets/pull/12",
      null,
      { repo: "acme/widgets", number: 12 },
    ],
    [
      "PR url with a tab suffix",
      "https://github.com/acme/widgets/pull/12/files",
      null,
      { repo: "acme/widgets", number: 12 },
    ],
    [
      "bare number uses the default repo",
      "12",
      "acme/widgets",
      { repo: "acme/widgets", number: 12 },
    ],
    [
      "hash number uses the default repo",
      "#12",
      "acme/widgets",
      { repo: "acme/widgets", number: 12 },
    ],
  ] as const)("%s", (label, input, defaultRepo, expected) => {
    expect(parseRef(input, defaultRepo)).toEqual(expected);
  });

  test.each([
    ["bare number without a default repo", "12", /owner\/repo#12/u],
    ["garbage", "not-a-pr", /not a PR reference/u],
  ] as const)("rejects %s", (label, input, error) => {
    expect(() => parseRef(input, null)).toThrow(error);
  });
});

test.each([
  ["git@github.com:acme/widgets.git", "acme/widgets"],
  ["https://github.com/acme/widgets.git", "acme/widgets"],
  ["https://github.com/acme/widgets", "acme/widgets"],
  ["ssh://git@github.com/acme/widgets.git", "acme/widgets"],
  ["https://gitlab.com/acme/widgets.git", null],
])("repoFromRemote(%s)", (url, expected) => {
  expect(repoFromRemote(url)).toBe(expected);
});

test.each([
  [
    "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
    ["gist", "read:org", "repo", "workflow"],
  ],
  ["  - Token scopes: admin:repo_hook, repo", ["admin:repo_hook", "repo"]],
  ["no scopes line", []],
])("scopesFrom %#", (text, expected) => {
  expect(scopesFrom(text)).toEqual(expected);
});
