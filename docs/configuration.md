# Configuration

`.pr-autopilot.yaml` (or `.yml` / `.json`) at the repo root. `pr-autopilot schema` prints the JSON Schema (also in `schema/`). Unknown keys are errors, and `pr-autopilot validate` reports each problem with its path.

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
| `notify[]` | `[]` | `{type: command, command, on: [kinds]}`; transition fields arrive as `PR_AUTOPILOT_*` env vars and JSON on stdin. `on` defaults to `ready, conflicted, checks_failed, merged` |
| `autoMerge.default` | `false` | auto-merge every tracked PR |
| `autoMerge.labels` | `[]` | PRs with these labels auto-merge; `pr-autopilot auto-merge <pr> on/off` overrides per PR |
| `autoMerge.method` | `squash` | `merge`, `squash` or `rebase`; the merge pins the head SHA |
| `autoMerge.command` | `null` | custom merge command instead of the REST merge (e.g. for merge queues or stacked PRs) |
| `reviewRequest.command` | `null` | run by `pr-autopilot request-review` |
| `reviewRequest.instruction` | `null` | text handed to Claude to request review with its own tools (`{url}`, `{number}`, `{repo}`, `{title}`, `{head}`) |
| `standards.files` | `[CLAUDE.md, AGENTS.md]` | what `/ship` reads first |
| `standards.skills` | `[]` | skills `/ship` loads first |
| `standards.prBodyTemplate` | `null` | |
| `delivery.channel` | `true` | |
| `delivery.monitor` | `auto` | `auto`, `always`, `off` |
| `delivery.playbook` | `null` | path to a playbook that replaces the bundled `pr-autopilot` skill |
| `hooks.sessionStart.enabled` | `true` | |
| `hooks.stop.enabled` | `true` | |
| `hooks.stop.scope` | `session` | `session` (PRs tracked with this session id), `repo` (PRs in this config's repos), `all` |
| `hooks.stop.maxBlocks` | `3` | consecutive blocks before letting go (Claude Code caps at 8) |
| `hooks.stop.blockOn*` | see schema | `Conflict`, `StaleBase`, `FailedChecks`, `ReviewFindings` default on; `HeadMovedWithoutReview` off |
| `daemon.source.type` | `gh-webhook-forward` | event source adapter id, or a path to your own module |
| `daemon.source.options` | `{}` | adapter options (below) |
| `daemon.port` | `8787` | local webhook receiver, bound to 127.0.0.1 |
| `daemon.secretEnv` | `PR_AUTOPILOT_WEBHOOK_SECRET` | if unset, a random secret is generated per daemon run |
| `daemon.debounceMs` | `500` | bursts for one PR collapse into one read |
| `daemon.backoffMs` | `[1000,2000,4000,8000,16000,30000]` | `UNKNOWN` mergeability re-reads |

One daemon serves every registered project (`~/.pr-autopilot/projects.json`). The first config's `daemon` section configures it.

Built-in source options:
- `gh-webhook-forward`: `events` (defaults to every event the router uses), `gh`, `hostname`, `path`, `restartBackoffMs`.
- `replay`: `file`, a JSONL of `{id, event, payload}` lines.

