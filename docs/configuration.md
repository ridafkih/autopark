# Configuration

`.autopark.yaml` (or `.yml` / `.json`) at the repo root. `autopark schema` prints the JSON Schema (also in `schema/`). Unknown keys are errors, and `autopark validate` reports each problem with its path.

| key | default | |
|---|---|---|
| `repos` | required | `owner/name` list this project covers |
| `track.authors` | `[]` | auto-track PRs by these logins; `@me` is the token's user |
| `track.branchPrefixes` | `[]` | auto-track head branches with these prefixes |
| `track.labels` | `[]` | auto-track PRs with any of these labels. Every non-empty filter must match; all empty means explicit `track` only |
| `checks.useGitHubRequired` | `true` | checks GitHub marks required (branch protection / rulesets) are required |
| `checks.required` | `[]` | extra required check names; a listed check missing from the head counts as pending |
| `checks.humanGates` | `[]` | checks that wait on a person; never failures, only block "mergeable now" |
| `checks.ignore` | `[]` | check names to drop entirely |
| `reviewers[]` | `[]` | `name`, `parser`, `logins` (default: the parser's), `minScore` (`null` = any), `required` (`true`), `requireOnHead` (`true`: the score must be for the current head), `options` |
| `readiness.noUnresolvedThreads` | `true` | |
| `readiness.countOutdatedThreads` | `true` | outdated but unresolved threads still block |
| `readiness.approvalOnHead` | `true` | an approval on an older commit does not count |
| `readiness.minApprovals` | `1` | |
| `readiness.noConflict` | `true` | |
| `readiness.requiredChecksPass` | `true` | if nothing is required, every non-gate check is |
| `readiness.allowDraft` | `false` | |
| `notify[]` | `[]` | `{type: command, command, on: [kinds]}`; transition fields arrive as `AUTOPARK_*` env vars and JSON on stdin. `on` defaults to `ready, conflicted, checks_failed, merged` |
| `autoMerge.default` | `false` | auto-merge every tracked PR |
| `autoMerge.labels` | `[]` | PRs with these labels auto-merge; `autopark auto-merge <pr> on/off` overrides per PR |
| `autoMerge.method` | `squash` | `merge`, `squash` or `rebase`; the merge pins the head SHA |
| `autoMerge.command` | `null` | custom merge command instead of the REST merge (e.g. for merge queues or stacked PRs) |
| `reviewRequest.command` | `null` | run by `autopark request-review` |
| `reviewRequest.instruction` | `null` | text handed to Claude to request review with its own tools (`{url}`, `{number}`, `{repo}`, `{title}`, `{head}`) |
| `reviewRequest.when` | `open` | `open` asks as soon as the PR is open; `ready` waits until it is reviewable (awaiting only human approval: out of draft, required checks green, reviewer thresholds met, no open threads or conflict) and re-asks once if the recorded request was made before then |
| `nudge.after` | `10m` | first `nudge` once a PR has been blocked by the same reasons for this long. Durations are text: `30s`, `10m`, `1h30m` |
| `nudge.every` | `10m` | repeat while it stays blocked (at least `1m`) |
| `nudge.escalateAfter` | `null` | once blocked this long, nudges carry `escalated: true` and lead with `ESCALATED` |
| `nudge.kinds` | every kind but `draft` | blocking reasons that nudge: the reason codes (`conflict`, `checks_failed`, `checks_pending`, `review_missing`, `review_stale`, `review_below_threshold`, `threads_open`, `changes_requested`, `approval_missing`, `approval_stale`, `human_gate_pending`, `mergeability_unknown`, `draft`) plus `awaiting_human`. A draft stays silent unless `draft` is listed |
| `nudge.quietWhenHeadMoving` | `true` | no nudge while the head moved within the last `after`; the work is visibly progressing |
| `nudge.nudgeReadyUnmerged` | `false` | also nudge PRs that are ready but not merged (by default a human merges them) |
| `standards.files` | `[CLAUDE.md, AGENTS.md]` | what `/ship` reads first |
| `standards.skills` | `[]` | skills `/ship` loads first |
| `standards.prBodyTemplate` | `null` | |
| `delivery.channel` | `true` | |
| `delivery.monitor` | `auto` | `auto`, `always`, `off` |
| `delivery.playbook` | `null` | path to a playbook that replaces the bundled `autopark` skill |
| `hooks.sessionStart.enabled` | `true` | |
| `hooks.stop.enabled` | `true` | |
| `hooks.stop.scope` | `session` | `session` (PRs tracked with this session id), `repo` (PRs in this config's repos), `all` |
| `hooks.stop.maxBlocks` | `3` | consecutive blocks before letting go (Claude Code caps at 8) |
| `hooks.stop.maxBriefs` | `10` | a block whose PRs, heads and codes match the last one this session saw says only `No change since last check.`; after this many in a row the full list comes back. `0` always prints the full list |
| `hooks.stop.blockOn*` | see schema | `Conflict`, `FailedChecks`, `ReviewFindings` default on; `HeadMovedWithoutReview` off; turning it on blocks on any open PR that needs approval and was never requested, green or not. Whatever these say, the Stop hook also blocks on a PR awaiting human review that was never requested, and on a PR that has been nudged; held PRs never block. A new nudge resets the `maxBlocks` count |
| `daemon.source.type` | `gh-webhook-forward` | event source adapter id, or a path to your own module |
| `daemon.source.options` | `{}` | adapter options (below) |
| `daemon.port` | `8787` | local webhook receiver, bound to 127.0.0.1 |
| `daemon.secretEnv` | `AUTOPARK_WEBHOOK_SECRET` | if unset, a random secret is generated per daemon run |
| `daemon.debounceMs` | `500` | bursts for one PR collapse into one read |
| `daemon.backoffMs` | `[1000,2000,4000,8000,16000,30000]` | `UNKNOWN` mergeability re-reads |

## Nudges and holds

Transitions fire once, when state changes, so a PR that stays stuck would otherwise go silent. The daemon keeps one timer for the next nudge due across every tracked PR, recomputed whenever a PR's state changes, and emits a `nudge` for each open, tracked PR that is still blocked. The blocking reasons are the ones `autopark status` shows. The clock restarts whenever the set of blocking reasons changes, and it survives daemon restarts; an overdue nudge fires as soon as the daemon is back.

A PR that needs a human approval gets one `approval_needed` as soon as the daemon sees it, without waiting for checks. With `reviewRequest.when: ready` it waits until the PR is reviewable instead: no `approval_needed`, no `re_request_review` nudge and no Stop hook approval item before then. `autopark request-review` records whether the PR was reviewable when asked; with `when: ready`, a request made earlier (for example while it was a draft) is asked once more when the PR becomes reviewable, with `requested_early` set and the reason saying the earlier request was made before the PR was reviewable. Requests recorded before this was tracked count as early. `autopark status` and `autopark check` show the request and whether it was early. Until `autopark request-review` records a request, every nudge for it leads with the approval request: if `reviewRequest.instruction` is set, the nudge carries it with `{url}`, `{head}` and the rest filled in; if only `reviewRequest.command` is set, it points at `autopark request-review <pr>`. Once a request is recorded the daemon never asks again for that PR, and a PR waiting only on that approval stops nudging. Approval counts as given when GitHub's review decision is `APPROVED`; bot reviews never count.

Only an explicit hold pauses this. `autopark hold <pr|all> [--for 30m] [--reason "..."]` stores an expiring hold (default 30m, at most 4h) in the daemon's state; `autopark unhold <pr|all>` releases it early (`all` releases every hold). A held PR doesn't nudge and the Stop hook doesn't block on it; `status`, the control API and the SessionStart summary show the hold. When it expires the daemon emits `hold_expired` and nudges anything overdue straight away.

One daemon serves every registered project (`~/.autopark/projects.json`). The first config's `daemon` section configures it.

Built-in source options:
- `gh-webhook-forward`: `events` (defaults to every event the router uses), `gh`, `hostname`, `path`, `restartBackoffMs`.
- `replay`: `file`, a JSONL of `{id, event, payload}` lines.

