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
| `readiness.baseFreshness.policy` | `off` | `contains-tip`: head must contain the base tip. `max-behind`: at most `maxBehind` base commits missing. `paths`: base changes since the merge base must not touch `paths` globs |
| `notify[]` | `[]` | `{type: command, command, on: [kinds]}`; transition fields arrive as `AUTOPARK_*` env vars and JSON on stdin. `on` defaults to `ready, conflicted, checks_failed, merged` |
| `autoMerge.default` | `false` | auto-merge every tracked PR |
| `autoMerge.labels` | `[]` | PRs with these labels auto-merge; `autopark auto-merge <pr> on/off` overrides per PR |
| `autoMerge.method` | `squash` | `merge`, `squash` or `rebase`; the merge pins the head SHA |
| `autoMerge.command` | `null` | custom merge command instead of the REST merge (e.g. for merge queues or stacked PRs) |
| `reviewRequest.command` | `null` | run by `autopark request-review` |
| `reviewRequest.instruction` | `null` | text handed to Claude to request review with its own tools (`{url}`, `{number}`, `{repo}`, `{title}`, `{head}`) |
| `nudge.after` | `10m` | first `nudge` once a PR has been blocked by the same reasons for this long. Durations are text: `30s`, `10m`, `1h30m` |
| `nudge.every` | `10m` | repeat while it stays blocked (at least `1m`) |
| `nudge.escalateAfter` | `null` | once blocked this long, nudges carry `escalated: true` and lead with `ESCALATED` |
| `nudge.kinds` | every kind but `draft` | blocking reasons that nudge: the reason codes (`conflict`, `stale_base`, `checks_failed`, `checks_pending`, `review_missing`, `review_stale`, `review_below_threshold`, `threads_open`, `changes_requested`, `approval_missing`, `approval_stale`, `human_gate_pending`, `mergeability_unknown`, `base_unknown`, `draft`) plus `awaiting_human`. A draft stays silent unless `draft` is listed |
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
| `hooks.stop.blockOn*` | see schema | `Conflict`, `StaleBase`, `FailedChecks`, `ReviewFindings` default on; `HeadMovedWithoutReview` off. Whatever these say, the Stop hook also blocks on a PR awaiting human review with no review request on its head, and on a PR that has been nudged; held PRs never block. A new nudge resets the `maxBlocks` count |
| `daemon.source.type` | `gh-webhook-forward` | event source adapter id, or a path to your own module |
| `daemon.source.options` | `{}` | adapter options (below) |
| `daemon.port` | `8787` | local webhook receiver, bound to 127.0.0.1 |
| `daemon.secretEnv` | `AUTOPARK_WEBHOOK_SECRET` | if unset, a random secret is generated per daemon run |
| `daemon.debounceMs` | `500` | bursts for one PR collapse into one read |
| `daemon.backoffMs` | `[1000,2000,4000,8000,16000,30000]` | `UNKNOWN` mergeability re-reads |

## Nudges and holds

Transitions fire once, when state changes, so a PR that stays stuck would otherwise go silent. The daemon keeps one timer for the next nudge due across every tracked PR, recomputed whenever a PR's state changes, and emits a `nudge` for each open, tracked PR that is still blocked. The blocking reasons are the ones `autopark status` shows. The clock restarts whenever the set of blocking reasons changes, and it survives daemon restarts; an overdue nudge fires as soon as the daemon is back.

For a PR waiting only on approval (`awaiting_human`), the nudge says to re-request review. If `reviewRequest.instruction` is set, the nudge carries it with `{url}`, `{head}` and the rest filled in; if only `reviewRequest.command` is set, it points at `autopark request-review <pr>`.

Only an explicit hold pauses this. `autopark hold <pr|all> [--for 30m] [--reason "..."]` stores an expiring hold (default 30m, at most 4h) in the daemon's state; `autopark unhold <pr|all>` releases it early (`all` releases every hold). A held PR doesn't nudge and the Stop hook doesn't block on it; `status`, the control API and the SessionStart summary show the hold. When it expires the daemon emits `hold_expired` and nudges anything overdue straight away.

One daemon serves every registered project (`~/.autopark/projects.json`). The first config's `daemon` section configures it.

Built-in source options:
- `gh-webhook-forward`: `events` (defaults to every event the router uses), `gh`, `hostname`, `path`, `restartBackoffMs`.
- `replay`: `file`, a JSONL of `{id, event, payload}` lines.

