import { describe, expect, test } from "bun:test";
import { shipContext } from "../src/hooks/ship-context.ts";
import { config } from "./fixtures/build.ts";
import { health } from "./fixtures/hook-state.ts";

const exists = (file: string) => file.endsWith("CLAUDE.md");

describe("/ship context", () => {
  test("lists standards, skills, review request, auto-merge and daemon state", () => {
    const projectConfig = config({
      standards: {
        files: ["CLAUDE.md", "AGENTS.md"],
        skills: ["team-standards"],
        prBodyTemplate: ".github/pull_request_template.md",
      },
      reviewRequest: { instruction: "Ask in #reviews for {url}" },
      autoMerge: { labels: ["automerge"] },
    });
    const text = shipContext({
      config: projectConfig,
      configPath: "/repo/.autopark.yaml",
      root: "/repo",
      health,
      exists,
    });
    expect(text).toContain("- Config: /repo/.autopark.yaml (acme/widgets)");
    expect(text).toContain("- Read before implementing: /repo/CLAUDE.md");
    expect(text).toContain("- Not present: AGENTS.md");
    expect(text).toContain("- Load these skills first: team-standards");
    expect(text).toContain("- PR body template: /repo/.github/pull_request_template.md");
    expect(text).toContain("- Review request: instruction (shown by `autopark request-review`)");
    expect(text).toContain(
      "- Auto-merge: off unless the user asks or the PR has a label in [automerge]",
    );
    expect(text).toContain("- Daemon: running (gh-webhook-forward connected)");
  });

  test("works without a config", () => {
    const text = shipContext({
      config: null,
      configPath: null,
      root: "/repo",
      health: null,
      exists,
    });
    expect(text).toContain("- Config: none found; run `autopark init` to create one");
    expect(text).toContain("- Daemon: not running; start it with `autopark daemon start`");
    expect(text).toContain(
      "- PR body template: none; match the conventions of recently merged PRs",
    );
  });
});
