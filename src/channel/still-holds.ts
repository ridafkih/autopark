import { isApprovalRequestDue, type ReviewRequestTiming } from "../core/approval-request.ts";
import { activeHold } from "../core/hold.ts";
import { isQueued } from "../core/merge-queue.ts";
import { nudgeKindsOf } from "../core/nudge.ts";
import type { Evaluation, LoggedTransition, TransitionKind } from "../core/types.ts";
import { reviewRequestOf, type PullRequestRecord } from "../daemon/store.ts";
import { recordOf, type CurrentState } from "./state.ts";

export const INSTRUCTION_KINDS: ReadonlySet<TransitionKind> = new Set<TransitionKind>([
  "approval_needed",
  "nudge",
  "hold_expired",
]);

interface Current {
  record: PullRequestRecord;
  evaluation: Evaluation;
  isHeld: boolean;
  when: ReviewRequestTiming;
}

const isOpenAndUnqueued = (evaluation: Evaluation) =>
  evaluation.state === "OPEN" && !isQueued(evaluation);

const sortedKinds = (kinds: unknown[]) => kinds.map(String).toSorted().join(",");

function hasSameBlockers(transition: LoggedTransition, evaluation: Evaluation) {
  const { kinds } = transition.data;
  if (!Array.isArray(kinds)) return false;
  return sortedKinds(kinds) === sortedKinds(nudgeKindsOf(evaluation));
}

const isNudgeCurrent = (transition: LoggedTransition, current: Current) =>
  isOpenAndUnqueued(current.evaluation) &&
  !current.isHeld &&
  transition.head === current.evaluation.headSha &&
  hasSameBlockers(transition, current.evaluation);

const isHoldExpiryCurrent = (current: Current) =>
  isOpenAndUnqueued(current.evaluation) && !current.isHeld && !current.evaluation.ready;

const isApprovalStillDue = ({ evaluation, record, when }: Current) =>
  isApprovalRequestDue(evaluation, reviewRequestOf(record), when);

function holdsAgainst(transition: LoggedTransition, current: Current) {
  if (transition.kind === "nudge") return isNudgeCurrent(transition, current);
  if (transition.kind === "hold_expired") return isHoldExpiryCurrent(current);
  return isApprovalStillDue(current);
}

export function stillHolds(
  transition: LoggedTransition,
  state: CurrentState,
  when: ReviewRequestTiming,
) {
  if (!INSTRUCTION_KINDS.has(transition.kind)) return true;
  const record = recordOf(state, transition);
  const evaluation = record?.tracked ? record.evaluation : null;
  if (!record || !evaluation) return false;
  const isHeld = activeHold(record.key, state.holds, state.now) !== null;
  return holdsAgainst(transition, { record, evaluation, isHeld, when });
}
