import type { Config } from "../../config/schema.ts";
import { shortSha } from "../format.ts";
import type { BaseComparison, Evaluation, Snapshot } from "../types.ts";

type BaseFreshness = Config["readiness"]["baseFreshness"];
type BaseEvaluation = Evaluation["base"];

const MAX_LISTED_PATHS = 5;

function touchedPaths(comparison: BaseComparison, globs: string[]) {
  const matchers = globs.map((glob) => new Bun.Glob(glob));
  return comparison.files.filter((file) => matchers.some((matcher) => matcher.match(file)));
}

function assessFreshness(freshness: BaseFreshness, comparison: BaseComparison) {
  if (freshness.policy === "contains-tip") return { stale: comparison.behindBy > 0, touched: [] };
  if (freshness.policy === "max-behind") {
    return { stale: comparison.behindBy > freshness.maxBehind, touched: [] };
  }
  if (freshness.policy !== "paths" || comparison.behindBy <= 0) {
    return { stale: false, touched: [] };
  }
  const touched = touchedPaths(comparison, freshness.paths);
  return { stale: touched.length > 0 || comparison.truncated, touched };
}

export function evaluateBase(snapshot: Snapshot, freshness: BaseFreshness) {
  const comparison = snapshot.baseComparison;
  const base: BaseEvaluation = {
    sha: snapshot.baseSha,
    behindBy: comparison?.behindBy ?? null,
    touched: [],
    stale: false,
    policy: freshness.policy,
  };
  if (freshness.policy === "off" || snapshot.state !== "OPEN") return { base, isUnknown: false };
  if (!comparison) return { base, isUnknown: true };
  return { base: { ...base, ...assessFreshness(freshness, comparison) }, isUnknown: false };
}

function touchedSummary(touched: string[]) {
  if (touched.length === 0) return "changed files beyond the compare limit";
  const listed = touched.slice(0, MAX_LISTED_PATHS).join(", ");
  const ellipsis = touched.length > MAX_LISTED_PATHS ? ", …" : "";
  return `touched ${listed}${ellipsis}`;
}

export function staleDetail(baseRef: string, base: BaseEvaluation) {
  const shaSuffix = base.sha ? ` @ ${shortSha(base.sha)}` : "";
  const where = `${baseRef}${shaSuffix}`;
  const remedy = `merge ${baseRef} in and re-run checks`;
  if (base.policy === "paths") {
    return `${where} moved ${base.behindBy} commit(s) and ${touchedSummary(base.touched)}; ${remedy}`;
  }
  return `head is ${base.behindBy} commit(s) behind ${where}; ${remedy}`;
}
