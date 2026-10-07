import type { PullRequestIndex } from "../core/route.ts";
import type { Evaluation } from "../core/types.ts";
import type { PullRequestRecord } from "./store.ts";

type EvaluationFilter = (evaluation: Evaluation | null) => boolean;

export function pullRequestIndex(records: PullRequestRecord[]): PullRequestIndex {
  const numbersWhere = (repo: string, isIncluded: EvaluationFilter) =>
    records
      .filter((record) => record.repo.toLowerCase() === repo && isIncluded(record.evaluation))
      .map((record) => record.number);
  return {
    bySha: (repo, sha) =>
      numbersWhere(repo, (evaluation) => evaluation?.headSha === sha.toLowerCase()),
    byHeadRef: (repo, ref) => numbersWhere(repo, (evaluation) => evaluation?.headRef === ref),
    byBaseRef: (repo, ref) =>
      numbersWhere(repo, (evaluation) => evaluation === null || evaluation.baseRef === ref),
  };
}
