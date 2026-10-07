# pr-autopilot

A Claude Code plugin that drives a pull request to "ready" from live GitHub events instead of polling.

You ask for a change with `/pr-autopilot:ship <task>`. Claude implements it to your project's standards, opens the PR and registers it. From then on a local daemon tells Claude the moment something happens: a conflict, a failed required check, a review score, an open thread, a stale base, an approval, ready, merged. Claude reacts using one playbook. When the PR is ready it tells you and waits for a human, unless you opted that PR into auto-merge.

## How it works

```
GitHub ──webhook──▶ event source adapter ──delivery──▶ pr-autopilotd ──▶ transitions.jsonl ──▶ channel server ──▶ Claude
        (gh webhook forward, replay, yours)            │                                    └─▶ plugin monitor (fallback)
                                                       ├─ dedupe on X-GitHub-Delivery (sqlite)
                                                       ├─ route to the affected PRs (a base push → every PR on that base)
                                                       ├─ ONE GraphQL query per PR (cost 1) → snapshot
                                                       │    mergeable UNKNOWN → re-read after 1,2,4,8,16,30 s
                                                       ├─ evaluate readiness (pure) → diff against last evaluation (pure)
                                                       └─ transitions → log, notify commands, optional auto-merge
```

- **Webhooks are only triggers.** The daemon never trusts payload contents. Every event leads to a fresh read of the PR's real state, and transitions come from the difference between the previous evaluation and the new one. A missed webhook therefore costs nothing once the next resync runs. Resyncs run on start, on wake from sleep, on every forwarder (re)connect, and on `POST /resync`.
- **Mergeability is not evented by GitHub.** It is computed lazily after a read. A push to a base branch rechecks every tracked PR on that base. If GitHub still says `UNKNOWN`, the daemon re-reads with bounded backoff, and only after an event, never on a timer.
- **Claude Code integration:**
  - The **channel** (an MCP server with the `claude/channel` capability) pushes each transition into the session.
  - The **plugin monitor** is the fallback. It tails the same log and prints one line per transition.
  - The **SessionStart hook** injects tracked PR status and the daemon's health.
  - The **Stop hook** keeps Claude working only while something is actionable.

### Transitions

| kind | meaning |
|---|---|
| `head_moved` | new head commit (`from`, `to`) |
| `conflicted` / `conflict_resolved` | mergeability flipped |
| `mergeability_unknown` | GitHub did not compute mergeability within the backoff |
| `stale_base` | head does not contain the base tip under the `baseFreshness` policy (`behind_by`, `touched`) |
| `checks_failed` | new failures on this head (`failed`, `required_failed`) |
| `checks_passed` | every required check passed on this head |
| `review_scored` | a reviewer bot scored (`bot`, `score`, `reviewed_head`, `on_head`, `meets_threshold`) |
| `threads_open` | unresolved thread count changed (`count`) |
| `approved_on_head` / `approval_stale` | approvals on the current head / only on older commits |
| `awaiting_human` | everything green except human approval |
| `ready` / `not_ready` | readiness flipped (`reasons`, `mergeable_now`) |
| `merge_attempted` | auto-merge ran (`ok`, `method`, `error`) |
| `merged` / `closed` | terminal; the PR stops being tracked |

## Quick start

Requirements: [Bun](https://bun.sh) 1.2.21+ (for `Bun.YAML`), the [GitHub CLI](https://cli.github.com) logged in, and Claude Code with claude.ai login (channels need it).

```sh
git clone <this repo> ~/pr-autopilot && cd ~/pr-autopilot && bun install

gh extension install cli/gh-webhook          # needed by the default event source

cd ~/code/your-repo
~/pr-autopilot/bin/pr-autopilot init         # writes .pr-autopilot.yaml and registers it
# or keep the config outside the repo: pr-autopilot register ~/.pr-autopilot/my-repo.yaml
~/pr-autopilot/bin/pr-autopilot doctor       # auth, scopes, extension, admin rights, daemon

~/pr-autopilot/bin/pr-autopilot daemon start     # or: daemon install (launchd/systemd, survives reboots)

claude plugin marketplace add ~/pr-autopilot
claude plugin install pr-autopilot@pr-autopilot
claude --dangerously-load-development-channels plugin:pr-autopilot@pr-autopilot
```

Then, in Claude Code: `/pr-autopilot:ship add rate limiting to the export endpoint`.

Without the channel flag, everything still works through the plugin monitor. With `delivery.monitor: auto` (the default), the monitor stays silent when it detects that the session loaded the channel, so you never get both.

Useful commands while it runs:

```sh
pr-autopilot status                 # tracked PRs and what blocks each
pr-autopilot check owner/repo#123   # one read + evaluation, no daemon needed
pr-autopilot track 123 --auto-merge # track an existing PR; opt it into auto-merge
pr-autopilot auto-merge 123 off
tail -F ~/.pr-autopilot/transitions.jsonl
```

`examples/ando.pr-autopilot.yaml` is a full real-world config: required checks, a human-gate check, Greptile at 5/5, base freshness, review requests through a chat tool, and a desktop notification.

## Config reference

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

## Extending

### An event-source adapter

An adapter turns *some* transport into deliveries. The core never knows which one is running.

```ts
// my-funnel-source.ts
import type { EventSource, SourceFactory } from "pr-autopilot/src/sources/types.ts";
import { startReceiver } from "pr-autopilot/src/sources/receiver.ts";

const factory: SourceFactory = (options, deps) => {
  let server: ReturnType<typeof startReceiver> | null = null;
  const source: EventSource = {
    name: "funnel",
    async start(ctx) {
      server = startReceiver({ hostname: "127.0.0.1", port: deps.port, path: "/github", secret: deps.secret, deliver: ctx.deliver });
      ctx.reconnected("funnel receiver up");
    },
    async stop() { server?.stop(true); },
    status: () => ({ name: "funnel", state: server ? "connected" : "stopped", detail: "" }),
  };
  return source;
};
export default factory;
```

Point `daemon.source.type` at the file (`./my-funnel-source.ts`, relative to the config). The contract:
- call `ctx.deliver({id, event, payload})` for each webhook;
- call `ctx.reconnected(reason)` whenever you may have missed events, which triggers a full resync;
- report `status()`.

`startReceiver` gives you HMAC verification (`X-Hub-Signature-256`). A Tailscale Funnel or cloudflared adapter is just this receiver plus a real repo webhook. smee is not recommended: anyone holding the URL can read private payloads.

### A reviewer parser

Most bots need only config. The built-in `regex` parser reads the score, the reviewed commit and the review count from the bot's comment:

```yaml
reviewers:
  - name: coderabbit
    parser: regex
    logins: [coderabbitai]
    minScore: 4
    options:
      marker: "<!-- This is an auto-generated comment: summarize by coderabbit.ai -->"
      score: "Score:\\s*(\\d+)\\s*/\\s*(\\d+)"     # group 1 score, optional group 2 max
      reviewedCommit: "Reviewed commit ([0-9a-f]{7,40})"
```

For anything else, export a `ReviewerParser` and set `parser: ./path/to/parser.ts`:

```ts
import type { ReviewerParser } from "pr-autopilot/src/reviewers/types.ts";
const parser: ReviewerParser = {
  id: "mybot",
  defaultLogins: ["mybot"],
  parse(comment) {
    const m = /score (\d+)\/10 for ([0-9a-f]{40})/.exec(comment.body);
    return m ? { score: +m[1], maxScore: 10, reviewedSha: m[2], reviewsCount: null, commentId: comment.id } : null;
  },
};
export default parser;
```

The built-in `greptile` parser:
- reads the hidden `<!-- greptile_confidence_score:N -->` marker, falling back to the visible `Confidence Score: N/5`;
- binds the score to the commit in the `Last reviewed commit` footer;
- picks the latest edit of the summary comment, which Greptile edits in place.

### The playbook

How Claude reacts to each transition lives in one file, `skills/pr-autopilot/SKILL.md`. To change it for a project, write your own and set `delivery.playbook: ./docs/pr-playbook.md`. The channel instructions and both hooks then point at your file instead.

## Running the daemon

- `pr-autopilot daemon start` / `stop` / `status`: detached process; logs to `~/.pr-autopilot/daemon.log`.
- `pr-autopilot daemon install`: a launchd agent on macOS (`~/Library/LaunchAgents/dev.pr-autopilot.daemon.plist`, `KeepAlive`). `--print` shows the plist without installing; `daemon uninstall` removes it.
- On Linux, the same command writes a systemd user unit (`~/.config/systemd/user/dev.pr-autopilot.daemon.service`, `Restart=always`) and enables it:
  ```ini
  [Service]
  ExecStart=/path/to/bun /path/to/pr-autopilot/src/daemon/main.ts
  Environment="PR_AUTOPILOT_HOME=%h/.pr-autopilot"
  Restart=always
  ```
- `pr-autopilot daemon run|start|install --config path` (repeatable) adds configs that live outside a repo; `daemon run` stays in the foreground for any other supervisor.

State lives in `~/.pr-autopilot` (override with `PR_AUTOPILOT_HOME`):
- `state.db`: sqlite holding deliveries, PRs, evaluations and transitions;
- `transitions.jsonl`: append-only log;
- `control.sock`: control API with `GET /health`, `GET /status`, `POST /track`, `/untrack`, `/auto-merge`, `/review-requested`, `/resync`;
- `daemon.log`, `projects.json`.

## Security

- **Webhook authenticity.** Every delivery is HMAC-verified. If you don't set `PR_AUTOPILOT_WEBHOOK_SECRET`, the daemon generates a random secret per run and hands it to the forwarder, so unsigned or forged requests to the local port are rejected. The receiver binds to 127.0.0.1 only.
- **What `gh webhook forward` does.**
  - It creates a temporary repository webhook named `cli` that is active only while it is connected, and relays deliveries over a websocket.
  - That requires admin on the repo and a token with `admin:repo_hook` (`repo` also covers it). `doctor` checks both.
  - The secret is passed as `--secret`, which other local users can see in `ps`.
- **Token use.** The daemon reads GitHub through `GH_TOKEN` / `GITHUB_TOKEN`, or `gh auth token`. It only reads, except for `PUT /pulls/{n}/merge` on PRs you opted into auto-merge.
- **Prompt injection.** Channel content is derived from GitHub state, but it includes PR titles and reasons that quote check names, both of which are text other people control. Treat events as data. The playbook tells Claude to act only on PRs its session drives.
- **Notify and merge commands** get transition data as environment variables, never interpolated into the command string. Quote them (`"$PR_AUTOPILOT_REASON"`) in your command.

## Known limits

- **One `gh webhook forward` per repo.** GitHub allows one `cli` hook per repo, so a second forwarder for the same repo (another machine or teammate) collides. It is a development feature that gives up after a few reconnects; the daemon restarts it with backoff and resyncs on every connect. For an always-on setup, use a real repo webhook through a tunnel adapter.
- **Deliveries made while nothing is connected are lost.** The next resync heals them from current state; history in between is not replayed.
- **Mergeability is not evented.** It is recomputed on base pushes and PR updates, plus the bounded backoff.
- **Channels are a research preview.** A custom channel needs `--dangerously-load-development-channels`, which only works in interactive sessions with claude.ai login. Stdio MCP servers are not auto-reconnected if they crash; reconnect from `/mcp`. The server never offers MCP revision 2026-07-28, which would unregister it as a channel, and the plugin sets `MCP_PROTOCOL_NEGOTIATION=legacy` as well.
- **Monitor `auto` mode** detects the channel by looking for the flag in its ancestor processes' command lines. Set `delivery.monitor` explicitly if that guess is wrong for your launcher.
- **Query windows.** One query reads up to 100 check contexts, 100 review threads, and the first and last 25 issue comments. A base comparison listing 300 or more files is treated as touching every watched path.
- **Platforms.** macOS and Linux only for service install.

## Development

```sh
bun install
bun test          # unit, table-driven, subprocess and end-to-end (replay adapter) tests
bun run typecheck
bun run schema    # regenerate schema/pr-autopilot.schema.json
```

All tests are deterministic: time comes from an injected clock, GitHub from a scripted fake, and webhooks from fixture payloads.
