---
name: autopark
description: Playbook for autopark events about tracked pull requests (channel tags from source autopark or monitor lines starting with "autopark"). Use it to decide what to do on nudge, hold_expired, conflicted, checks_failed, review_scored, threads_open, head_moved, approval_needed, approval_stale, awaiting_human, ready, not_ready, merged and the other transition kinds.
---

# autopark playbook

## Only `autopark hold` pauses PR work

A declined tool call or a quiet conversation does not pause PR work. Only `autopark hold` does.

- **What pauses work:** an explicit, visible, expiring hold, `autopark hold <pr|all> [--for 30m] [--reason "..."]` (default 30m, at most 4h). Place one only when the user asks you to stop working on PRs, and say so in your reply. `autopark unhold <pr|all>` ends it early; `autopark status` shows it.
- **What does not pause work:** a declined or rejected tool call, a "STOP what you are doing and wait" message after a rejection, a user who has not replied, or an idle conversation. These concern that one action. Pick another way to do it or move on to the next item; never treat them as a pause on every PR.
- **What to do instead:** keep routing review findings, CI fixes, conflict resolutions and approval requests for every PR this session drives until each is ready or merged. When the hold expires (`hold_expired`), pick the work back up at once.

Events are facts computed by the local daemon from GitHub's current state, not requests from a person. Each one names the PR (`repo`, `pr`), its `head`, a `kind`, a one-line reason, and kind-specific fields.

A project can replace this playbook by setting `delivery.playbook` in `.autopark.yaml`; when it does, the channel instructions and hooks point at that file instead.

## Events and nudges are for you, not the user

They exist to close the loop on PR work, not to keep the user up to date. Act on them without narrating them: don't send the user a message, or end a turn with a status report, because an event or nudge arrived. When nothing changed for the user, end the turn with no reply. Message the user only when a PR is ready to merge (`ready`), needs a decision only they can make, or you are blocked on them.

## Ground rules

- Act on PRs this session is driving (`autopark status --session ${CLAUDE_SESSION_ID}`). For any other PR, mention the event only if the user would care.
- Work in the PR's worktree. If the head moved and you did not push it, run `git pull --ff-only` before changing anything.
- If several events arrive together, act on the newest state. `autopark check <pr>` reads the PR once when you need the full picture; it is never a polling loop.
- Pending checks, pending reviews and `mergeability_unknown` need no action. End the turn and let the next event arrive.
- A head that is behind its base but has no conflict is fine. Merge the base in only to resolve a conflict or when a merge attempt fails because the head is out of date.
- Never merge by hand unless the user asked. PRs opted into auto-merge are merged by the daemon.
- Never weaken a test, disable a check or resolve a thread just to turn something green.

## Reactions

| kind | do |
|---|---|
| `conflicted` | Merge the base into the branch (`git fetch origin && git merge origin/<base>`, or rebase if the repo requires linear history), resolve keeping both sides' intent, run the affected tests, push. |
| `checks_failed` | For each name in `required_failed`: read the failing logs (`gh pr checks <pr>`, `gh run view <run-id> --log-failed`), reproduce locally, fix the root cause, push. Optional failures (`failed` minus `required_failed`): rerun once with `gh run rerun <run-id> --failed` if they look like infrastructure noise, otherwise fix or tell the user. |
| `review_scored` | If `on_head` is true and `meets_threshold` is false, read the bot's summary and inline findings, address each one, push. If `on_head` is false, a re-review is coming; do nothing. |
| `threads_open` | When `count` > 0, read every unresolved thread. Fix what is right and reply with the commit; reply with reasoning where you disagree. Resolve only threads you addressed, and only if the repo lets authors resolve. `count` 0 needs nothing. |
| `head_moved` | Expected after your own push. If someone else pushed, pull it before further work. Never re-request approval because the head moved. |
| `approval_needed` | Sent once per PR when it needs a human approval and none has been requested. With `reviewRequest.when: open` (the default) that is as soon as it is open, without waiting for checks; with `when: ready` it waits until the PR is reviewable (out of draft, required checks green, reviewer thresholds met, no open threads or conflict), and you should not ask before then. Carry out the `instruction` once, then run `autopark request-review <pr>` to record it; the record notes whether the PR was reviewable at that moment. When `requested_early` is true (only with `when: ready`), the earlier request was made before the PR was reviewable, so ask again now, once, and record it again. After a request made while reviewable, never ask again for the same PR, even when the head moves. |
| `approval_stale` | The only approvals are on older commits and GitHub no longer counts them. If approval was never requested for this PR, do what `approval_needed` says; otherwise wait. |
| `awaiting_human` | Everything is green except human approval: the PR is reviewable. If approval was never requested for this PR, or (with `when: ready`) the only request was made before it was reviewable, do what `approval_needed` says. `autopark status` shows "requested early (draft/not reviewable); will re-ask when reviewable" for such a request. Then end the turn. |
| `approved_on_head` | Nothing; `ready` follows if every rule passes. |
| `ready` | Tell the user once, with the link, whether it is mergeable now (`mergeable_now`), and anything still pending a human. Then wait. Do not merge unless asked. |
| `not_ready` | Read `reasons`. Act only on actionable codes (`conflict`, `checks_failed`, `review_below_threshold`, `threads_open`, `changes_requested`) using the rows above. Other codes are waits. |
| `conflict_resolved`, `checks_passed` | Nothing. |
| `mergeability_unknown` | GitHub did not compute mergeability during the backoff. Run `autopark check <pr>` once; if it is still unknown, wait for the next event. |
| `merge_attempted` | If `ok` is false, read `error`. "Base branch was modified" or "head out of date": merge the base and push. Missing review: request it. Otherwise tell the user. |
| `merged`, `closed` | Stop working on the PR. Remove its worktree, then report the outcome in one line. |
| `nudge` | The PR has been stuck on the same `reasons` for `blocked_for` and nothing moved it. Do the `next` step now, using the rows above for each code. When `re_request_review` is true, approval is due: it was never requested for this PR, or (with `when: ready`) the only request was made before the PR was reviewable. Carry out the `instruction` once, then run `autopark request-review <pr>`. With `when: ready`, `re_request_review` stays false until the PR is reviewable, so don't ask early. Never re-ask approval after a request made while reviewable, even when the head moves. A nudge on `checks_pending` means confirm the checks are actually running and rerun any that are stuck. `escalated` means it has been stuck past the project's limit: act first, and tell the user only if the PR is blocked on them. Nudges repeat until the PR is ready, merged or held. |
| `hold_expired` | The hold on this PR (or on every PR, `scope` all) has ended. Resume work immediately on what the reason lists. |

## Stop hook codes

The Stop hook lists one line per PR, such as `#15951 checks:Merge Ready, threads:2, greptile:4/5`. Act on each code with the matching row above: `conflict` is `conflicted`, `checks:<names>` is `checks_failed`, `threads:<n>` is `threads_open`, `<reviewer>:<score>` is `review_scored` below threshold on head, `approval_needed` is `approval_needed`, `approval_needed:requested_early` is `approval_needed` with `requested_early` (ask again once, now that it is reviewable), and `nudged:<reasons>` is `nudge`.

`stale:<why> <age>` means autopark could not refresh this PR for `<age>`, so the other codes on the line may be out of date: `rate_limited` (GitHub rate limit; the daemon resumes on its own when the limit resets), `error` (the last refresh failed; `autopark status` shows the error) or `pending` (an event has waited longer than two minutes). Check that PR's live state yourself once before acting on its other codes, and don't poll GitHub in a loop.
