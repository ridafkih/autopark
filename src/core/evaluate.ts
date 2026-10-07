import type { Config } from "../config/schema.ts";
import type { ReviewerParser } from "../reviewers/types.ts";
import { evaluateApprovals } from "./readiness/approvals.ts";
import { evaluateBase } from "./readiness/base.ts";
import { evaluateChecks } from "./readiness/checks.ts";
import { collectReasons } from "./readiness/reasons.ts";
import { evaluateReviewers } from "./readiness/reviewers.ts";
import type { Evaluation, Reason, ReviewThread, Snapshot } from "./types.ts";

const MERGE_NOW_STATES = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);
const HUMAN_ONLY = new Set(["approval_missing", "approval_stale"]);

const countOpenThreads = (threads: ReviewThread[], readiness: Config["readiness"]) =>
  threads.filter(
    (thread) => !thread.resolved && (readiness.countOutdatedThreads || !thread.outdated),
  ).length;

const identityOf = (snapshot: Snapshot) => ({
  repo: snapshot.repo,
  number: snapshot.number,
  title: snapshot.title,
  url: snapshot.url,
  state: snapshot.state,
  isDraft: snapshot.isDraft,
  headRef: snapshot.headRef,
  baseRef: snapshot.baseRef,
  headSha: snapshot.headSha,
  labels: snapshot.labels,
});

const isAwaitingHuman = (reasons: Reason[]) =>
  reasons.length > 0 && reasons.every((reason) => HUMAN_ONLY.has(reason.code));

function assessReadiness(snapshot: Snapshot, config: Config, parsers: Map<string, ReviewerParser>) {
  const { readiness } = config;
  const { base, isUnknown } = evaluateBase(snapshot, readiness.baseFreshness);
  const assessment = {
    base,
    checks: evaluateChecks(snapshot.checks, config.checks),
    reviewers: evaluateReviewers(snapshot, config.reviewers, parsers),
    threadsOpen: countOpenThreads(snapshot.threads, readiness),
    approvals: evaluateApprovals(snapshot),
  };
  const reasons = collectReasons({ snapshot, readiness, isBaseUnknown: isUnknown, ...assessment });
  return { ...assessment, reasons };
}

export function evaluate(
  snapshot: Snapshot,
  config: Config,
  parsers: Map<string, ReviewerParser>,
  previous: Evaluation | null,
): Evaluation {
  const { base, checks, reviewers, threadsOpen, approvals, reasons } = assessReadiness(
    snapshot,
    config,
    parsers,
  );
  const isReady = reasons.length === 0;
  const areGatesPassing = checks.gates.every((gate) => gate.outcome === "pass");
  const lastKnownMergeable =
    snapshot.mergeable === "UNKNOWN"
      ? (previous?.lastKnownMergeable ?? "UNKNOWN")
      : snapshot.mergeable;
  return {
    ...identityOf(snapshot),
    base,
    mergeable: snapshot.mergeable,
    lastKnownMergeable,
    mergeStateStatus: snapshot.mergeStateStatus,
    checks,
    reviewers,
    threadsOpen,
    approvals,
    reasons,
    ready: isReady,
    mergeableNow: isReady && areGatesPassing && MERGE_NOW_STATES.has(snapshot.mergeStateStatus),
    awaitingHuman: isAwaitingHuman(reasons),
  };
}
