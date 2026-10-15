import { formatClockTime, formatDuration } from "../core/duration.ts";
import type { Clock } from "../daemon/clock.ts";
import { RateLimitError, type RateLimitHint } from "./rate-limit.ts";

export interface GitHubPause {
  until: number;
  reason: string;
}

export type RequestKind = "graphql" | "rest";

export interface RequestGateOptions {
  clock: Clock;
  graphqlSpacingMs?: number;
  log?: (message: string) => void;
}

const INITIAL_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const BACKOFF_FACTOR = 2;
const RATE_LIMITED = "rate limited";
const MAX_LOGGED_MESSAGE = 160;

async function quietly(promise: Promise<unknown>) {
  try {
    await promise;
  } catch {
    // The caller of run() receives the error; the queue only needs to move on.
  }
}

export class RequestGate {
  private tail: Promise<void> = Promise.resolve();
  private nextGraphqlAt = Number.NEGATIVE_INFINITY;
  private paused: GitHubPause | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;

  constructor(private readonly options: RequestGateOptions) {}

  pause(): GitHubPause | null {
    const { paused } = this;
    return paused && this.options.clock.now() < paused.until ? paused : null;
  }

  run<Result>(kind: RequestKind, send: () => Promise<Result>): Promise<Result> {
    const turn = this.take(this.tail, kind, send);
    this.tail = quietly(turn);
    return turn;
  }

  limit(hint: RateLimitHint, message: string): RateLimitError {
    const current = this.pause();
    const until = Math.max(this.untilFor(hint), current?.until ?? 0);
    if (!current) this.announce(until, message);
    this.paused = { until, reason: RATE_LIMITED };
    return new RateLimitError(message, until);
  }

  succeeded() {
    this.backoffMs = INITIAL_BACKOFF_MS;
  }

  private async take<Result>(tail: Promise<void>, kind: RequestKind, send: () => Promise<Result>) {
    await tail;
    const pause = this.pause();
    if (pause) {
      const until = formatClockTime(pause.until);
      throw new RateLimitError(`GitHub calls paused until ${until} (${pause.reason})`, pause.until);
    }
    await this.space(kind);
    return send();
  }

  private async space(kind: RequestKind) {
    if (kind !== "graphql") return;
    const { clock, graphqlSpacingMs = 0 } = this.options;
    const waitMs = this.nextGraphqlAt - clock.now();
    if (waitMs > 0) await clock.sleep(waitMs);
    this.nextGraphqlAt = clock.now() + graphqlSpacingMs;
  }

  private untilFor({ retryAfterMs, resetAt }: RateLimitHint) {
    const now = this.options.clock.now();
    if (retryAfterMs !== null) return now + retryAfterMs;
    if (resetAt !== null && resetAt > now) return resetAt;
    const delayMs = this.backoffMs;
    this.backoffMs = Math.min(delayMs * BACKOFF_FACTOR, MAX_BACKOFF_MS);
    return now + delayMs;
  }

  private announce(until: number, message: string) {
    const resumes = formatClockTime(until);
    const wait = formatDuration(until - this.options.clock.now());
    const why = message.slice(0, MAX_LOGGED_MESSAGE);
    this.options.log?.(
      `GitHub rate limited (${why}); pausing all GitHub calls until ${resumes} (${wait})`,
    );
  }
}
