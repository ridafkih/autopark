import { isRecord, stringAt } from "../core/json.ts";

export interface RateLimitHint {
  retryAfterMs: number | null;
  resetAt: number | null;
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly resumeAt: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export const isRateLimitError = (error: unknown): error is RateLimitError =>
  error instanceof RateLimitError;

const MS_PER_SECOND = 1000;
const TOO_MANY_REQUESTS = 429;
const FORBIDDEN = 403;
const RATE_LIMIT_TEXT = /rate limit|abuse detection/iu;

function secondsHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * MS_PER_SECOND : null;
}

export const isExhausted = (headers: Headers) => headers.get("x-ratelimit-remaining") === "0";

export const hintFrom = (headers: Headers): RateLimitHint => ({
  retryAfterMs: secondsHeader(headers, "retry-after"),
  resetAt: isExhausted(headers) ? secondsHeader(headers, "x-ratelimit-reset") : null,
});

export function isRateLimitedResponse(response: Response, detail: string) {
  if (response.status === TOO_MANY_REQUESTS) return true;
  if (response.status !== FORBIDDEN) return false;
  return RATE_LIMIT_TEXT.test(detail) || isExhausted(response.headers);
}

export const isRateLimitedGraphqlError = (error: unknown) =>
  isRecord(error) &&
  (error.type === "RATE_LIMITED" || RATE_LIMIT_TEXT.test(stringAt(error, "message") ?? ""));
