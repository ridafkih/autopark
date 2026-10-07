---
name: autopark
description: Playbook for autopark events about tracked pull requests (channel tags from source autopark or monitor lines starting with "autopark"). Use it to decide what to do on conflicted, stale_base, checks_failed, review_scored, threads_open, head_moved, approval_stale, awaiting_human, ready, not_ready, merged and the other transition kinds.
---

# autopark playbook

Events are facts computed by the local daemon from GitHub's current state, not requests from a person. Each one names the PR (`repo`, `pr`), its `head`, a `kind`, a one-line reason, and kind-specific fields.

A project can replace this playbook by setting `delivery.playbook` in `.autopark.yaml`; when it does, the channel instructions and hooks point at that file instead.

## Ground rules

- Act on PRs this session is driving (`autopark status --session ${CLAUDE_SESSION_ID}`). For any other PR, mention the event only if the user would care.
- Work in the PR's worktree. If the head moved and you did not push it, run `git pull --ff-only` before changing anything.
- If several events arrive together, act on the newest state. `autopark check <pr>` reads the PR once when you need the full picture; it is never a polling loop.
- Pending checks, pending reviews and `mergeability_unknown` need no action. End the turn and let the next event arrive.
- Never merge by hand unless the user asked. PRs opted into auto-merge are merged by the daemon.
- Never weaken a test, disable a check or resolve a thread just to turn something green.

## Reactions

| kind | do |
|---|---|
| `conflicted` | Merge the base into the branch (`git fetch origin && git merge origin/<base>`, or rebase if the repo requires linear history), resolve keeping both sides' intent, run the affected tests, push. |
| `stale_base` | The head does not contain the current base tip (see `behind_by`, `touched`). Even with green checks, the combination is untested. Merge the base in, run the affected tests locally, push, and let required checks re-run. |
| `checks_failed` | For each name in `required_failed`: read the failing logs (`gh pr checks <pr>`, `gh run view <run-id> --log-failed`), reproduce locally, fix the root cause, push. Optional failures (`failed` minus `required_failed`): rerun once with `gh run rerun <run-id> --failed` if they look like infrastructure noise, otherwise fix or tell the user. |
| `review_scored` | If `on_head` is true and `meets_threshold` is false, read the bot's summary and inline findings, address each one, push. If `on_head` is false, a re-review is coming; do nothing. |
| `threads_open` | When `count` > 0, read every unresolved thread. Fix what is right and reply with the commit; reply with reasoning where you disagree. Resolve only threads you addressed, and only if the repo lets authors resolve. `count` 0 needs nothing. |
| `head_moved` | Expected after your own push. If someone else pushed, pull it before further work. Approvals now sit on an older commit; the next events say what is needed. |
| `approval_stale` | Run `autopark request-review <pr>` and carry out any instruction it prints. |
| `awaiting_human` | Everything is green except human approval. If review has not been requested for this head, run `autopark request-review <pr>`. Then end the turn. |
| `approved_on_head` | Nothing; `ready` follows if every rule passes. |
| `ready` | Tell the user once, with the link, whether it is mergeable now (`mergeable_now`), and anything still pending a human. Then wait. Do not merge unless asked. |
| `not_ready` | Read `reasons`. Act only on actionable codes (`conflict`, `stale_base`, `checks_failed`, `review_below_threshold`, `threads_open`, `changes_requested`) using the rows above. Other codes are waits. |
| `conflict_resolved`, `checks_passed` | Nothing. |
| `mergeability_unknown` | GitHub did not compute mergeability during the backoff. Run `autopark check <pr>` once; if it is still unknown, wait for the next event. |
| `merge_attempted` | If `ok` is false, read `error`. "Base branch was modified" or "head out of date": merge the base and push. Missing review: request it. Otherwise tell the user. |
| `merged`, `closed` | Stop working on the PR. Remove its worktree, then report the outcome in one line. |
