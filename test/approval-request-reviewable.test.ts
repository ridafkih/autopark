import { describe, expect, test } from "bun:test";
import { isReviewableForRequest } from "../src/core/approval-request.ts";
import type { Reason } from "../src/core/types.ts";

const reason = (code: Reason["code"]): Reason => ({ code, detail: "" });

describe("a recorded review request is early only when the PR was not reviewable", () => {
  test.each([
    ["checks still pending", [reason("checks_pending"), reason("approval_missing")], true],
    ["checks failed", [reason("checks_failed"), reason("approval_missing")], true],
    ["only approval missing", [reason("approval_missing")], true],
    ["draft", [reason("draft")], false],
    ["open threads", [reason("threads_open")], false],
    ["reviewer below threshold", [reason("review_below_threshold")], false],
    ["reviewer has not scored", [reason("review_missing")], false],
    ["reviewer scored an older head", [reason("review_stale")], false],
    ["changes requested", [reason("changes_requested")], false],
    ["conflict", [reason("conflict")], false],
  ] as const)("%s", (label, reasons, expected) => {
    expect(isReviewableForRequest(true, [...reasons])).toBe(expected);
  });

  test("a closed PR is never reviewable", () => {
    expect(isReviewableForRequest(false, [])).toBe(false);
  });
});
