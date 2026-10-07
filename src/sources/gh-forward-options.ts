export const DEFAULT_EVENTS = [
  "push",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
  "issue_comment",
  "check_run",
  "check_suite",
  "status",
];

const DEFAULT_RESTART_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];

export interface GhForwardOptions {
  gh: string;
  events: string[];
  hostname: string;
  path: string;
  restartBackoffMs: number[];
}

const stringOption = (options: Record<string, unknown>, key: string, fallback: string) => {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
};

function arrayOption<Item>(options: Record<string, unknown>, key: string, fallback: Item[]) {
  const value = options[key];
  return Array.isArray(value) ? (value as Item[]) : fallback;
}

export const readForwardOptions = (options: Record<string, unknown>): GhForwardOptions => ({
  gh: stringOption(options, "gh", "gh"),
  events: arrayOption(options, "events", DEFAULT_EVENTS),
  hostname: stringOption(options, "hostname", "127.0.0.1"),
  path: stringOption(options, "path", "/github"),
  restartBackoffMs: arrayOption(options, "restartBackoffMs", DEFAULT_RESTART_BACKOFF_MS),
});

export function forwardArgs(options: GhForwardOptions, repo: string, port: number, secret: string) {
  const events = options.events.join(",");
  return [
    options.gh,
    "webhook",
    "forward",
    `--repo=${repo}`,
    `--events=${events}`,
    `--url=http://${options.hostname}:${port}${options.path}`,
    `--secret=${secret}`,
  ];
}
