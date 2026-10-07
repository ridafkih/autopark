import { shaMatches } from "../sha.ts";
import type { Approval, Evaluation, Snapshot } from "../types.ts";

const loginOf = (approval: Approval) => approval.login;

export function evaluateApprovals(snapshot: Snapshot): Evaluation["approvals"] {
  const approved = snapshot.approvals.filter((approval) => approval.state === "APPROVED");
  const isOnHead = (approval: Approval) => shaMatches(approval.sha, snapshot.headSha);
  return {
    onHead: approved.filter(isOnHead).map(loginOf),
    stale: approved.filter((approval) => !isOnHead(approval)).map(loginOf),
    changesRequested: snapshot.approvals
      .filter((approval) => approval.state === "CHANGES_REQUESTED")
      .map(loginOf),
  };
}
