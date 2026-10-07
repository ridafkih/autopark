import { formatFailedChecks } from "../format.ts";
import type { FailedCheck } from "../types.ts";
import type { Detector } from "./context.ts";
import { describeSha } from "./context.ts";

const nameOf = (check: FailedCheck) => check.name;

function failureSummary(failed: FailedCheck[]) {
  const groups: Array<[string, FailedCheck[]]> = [
    ["required failed", failed.filter((check) => check.required)],
    ["optional failed", failed.filter((check) => !check.required)],
  ];
  return groups
    .filter(([, checks]) => checks.length > 0)
    .map(([label, checks]) => `${label}: ${formatFailedChecks(checks)}`)
    .join("; ");
}

export const detectChecksFailed: Detector = ({ sameHeadPrevious, next, emit }) => {
  const previouslyFailed = new Set(sameHeadPrevious?.checks.failed.map(nameOf));
  const newlyFailed = next.checks.failed.filter((check) => !previouslyFailed.has(check.name));
  if (newlyFailed.length === 0) return [];
  return [
    emit("checks_failed", failureSummary(newlyFailed), {
      names: newlyFailed.map(nameOf),
      required: newlyFailed.filter((check) => check.required).map(nameOf),
      checks: newlyFailed,
    }),
  ];
};

export const detectChecksPassed: Detector = ({ sameHeadPrevious, next, emit }) => {
  if (!next.checks.requiredGreen || sameHeadPrevious?.checks.requiredGreen) return [];
  return [emit("checks_passed", `required checks passed on ${describeSha(next.headSha)}`)];
};
