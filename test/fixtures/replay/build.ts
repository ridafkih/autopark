import { greptileSummary } from "../greptile.ts";

export const FIRST_HEAD = "1111111111111111111111111111111111111111";
export const SECOND_HEAD = "2222222222222222222222222222222222222222";
export const THIRD_HEAD = "3333333333333333333333333333333333333333";
const repository = {
  id: 1,
  full_name: "acme/widgets",
  name: "widgets",
  owner: { login: "acme" },
  private: true,
};
const sender = { login: "octo", type: "User" };

const pullRequest = (head: string, extra: Record<string, unknown> = {}) => ({
  url: "https://api.github.com/repos/acme/widgets/pulls/7",
  html_url: "https://github.com/acme/widgets/pull/7",
  number: 7,
  state: "open",
  draft: false,
  merged: false,
  title: "Tidy the widget loader",
  user: { login: "octo", type: "User" },
  head: { ref: "bot/tidy", sha: head, repo: { full_name: "acme/widgets" } },
  base: { ref: "main", sha: "b".repeat(40), repo: { full_name: "acme/widgets" } },
  labels: [],
  ...extra,
});

export const deliveries = {
  opened: {
    id: "0b1c-opened",
    event: "pull_request",
    payload: {
      action: "opened",
      number: 7,
      pull_request: pullRequest(FIRST_HEAD),
      repository,
      sender,
    },
  },
  buildFailed: {
    id: "0b1c-check-fail",
    event: "check_run",
    payload: {
      action: "completed",
      check_run: {
        id: 501,
        name: "build",
        head_sha: FIRST_HEAD,
        status: "completed",
        conclusion: "failure",
        app: { slug: "github-actions" },
        pull_requests: [
          { number: 7, head: { ref: "bot/tidy", sha: FIRST_HEAD }, base: { ref: "main" } },
        ],
      },
      repository,
      sender,
    },
  },
  synchronize2: {
    id: "0b1c-sync-2",
    event: "pull_request",
    payload: {
      action: "synchronize",
      number: 7,
      before: FIRST_HEAD,
      after: SECOND_HEAD,
      pull_request: pullRequest(SECOND_HEAD),
      repository,
      sender,
    },
  },
  suitePassed: {
    id: "0b1c-suite",
    event: "check_suite",
    payload: {
      action: "completed",
      check_suite: {
        id: 77,
        head_sha: SECOND_HEAD,
        status: "completed",
        conclusion: "success",
        app: { slug: "github-actions" },
        pull_requests: [],
      },
      repository,
      sender,
    },
  },
  greptile2: {
    id: "0b1c-greptile-2",
    event: "issue_comment",
    payload: {
      action: "edited",
      issue: {
        number: 7,
        pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/7" },
      },
      comment: {
        id: 9001,
        user: { login: "greptile-apps[bot]", type: "Bot" },
        body: greptileSummary({ score: 5, sha: SECOND_HEAD, reviews: 1 }),
      },
      repository,
      sender: { login: "greptile-apps[bot]", type: "Bot" },
    },
  },
  approved2: {
    id: "0b1c-approve-2",
    event: "pull_request_review",
    payload: {
      action: "submitted",
      review: { id: 3001, state: "approved", commit_id: SECOND_HEAD, user: { login: "reviewer" } },
      pull_request: pullRequest(SECOND_HEAD),
      repository,
      sender: { login: "reviewer" },
    },
  },
  synchronize3: {
    id: "0b1c-sync-3",
    event: "pull_request",
    payload: {
      action: "synchronize",
      number: 7,
      before: SECOND_HEAD,
      after: THIRD_HEAD,
      pull_request: pullRequest(THIRD_HEAD),
      repository,
      sender,
    },
  },
  greptile3: {
    id: "0b1c-greptile-3",
    event: "issue_comment",
    payload: {
      action: "edited",
      issue: {
        number: 7,
        pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/7" },
      },
      comment: {
        id: 9001,
        user: { login: "greptile-apps[bot]", type: "Bot" },
        body: greptileSummary({ score: 5, sha: THIRD_HEAD, reviews: 2 }),
      },
      repository,
      sender: { login: "greptile-apps[bot]", type: "Bot" },
    },
  },
  approved3: {
    id: "0b1c-approve-3",
    event: "pull_request_review",
    payload: {
      action: "submitted",
      review: { id: 3002, state: "approved", commit_id: THIRD_HEAD, user: { login: "reviewer" } },
      pull_request: pullRequest(THIRD_HEAD),
      repository,
      sender: { login: "reviewer" },
    },
  },
  merged: {
    id: "0b1c-closed",
    event: "pull_request",
    payload: {
      action: "closed",
      number: 7,
      pull_request: pullRequest(THIRD_HEAD, {
        state: "closed",
        merged: true,
        merge_commit_sha: "4".repeat(40),
      }),
      repository,
      sender,
    },
  },
};

if (import.meta.main) {
  const order = [
    "opened",
    "buildFailed",
    "buildFailed",
    "synchronize2",
    "suitePassed",
    "greptile2",
    "approved2",
  ] as const;
  const lines = order.map((name) => JSON.stringify(deliveries[name]));
  process.stdout.write(`${lines.join("\n")}\n`);
}
