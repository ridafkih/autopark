# The daemon

- `autopark daemon start` / `stop` / `status`: detached process; logs to `~/.autopark/daemon.log`.
- `autopark daemon install`: a launchd agent on macOS (`~/Library/LaunchAgents/dev.autopark.daemon.plist`, `KeepAlive`). `--print` shows the plist without installing; `daemon uninstall` removes it.
- On Linux, the same command writes a systemd user unit (`~/.config/systemd/user/dev.autopark.daemon.service`, `Restart=always`) and enables it:
  ```ini
  [Service]
  ExecStart=/path/to/bun /path/to/autopark/src/daemon/main.ts
  Environment="AUTOPARK_HOME=%h/.autopark"
  Restart=always
  ```
- GitHub calls go out one at a time, with at least a second between GraphQL queries. A rate limit (a 403 or 429 secondary limit, a GraphQL "rate limit exceeded" error, or `x-ratelimit-remaining: 0`) pauses every GitHub call until `retry-after` or `x-ratelimit-reset`, or for a minute doubling up to 30 minutes when GitHub gives neither. The log gets one line per pause. Recomputes that hit the pause wait for it to end and never give up; `autopark status` shows `GitHub paused until HH:MM (rate limited)`, and each PR whose last refresh failed, or whose newest event is more than two minutes newer than its evaluation, shows as `stale` in `status` and in the Stop hook.
- A `pull_request` closed or merged event ends tracking for that PR without another GitHub read; a reopened event resumes it.
- `autopark daemon run|start|install --config path` (repeatable) adds configs that live outside a repo; `daemon run` stays in the foreground for any other supervisor.

State lives in `~/.autopark` (override with `AUTOPARK_HOME`):
- `state.db`: sqlite holding deliveries, PRs, evaluations, nudge clocks, holds and transitions;
- `transitions.jsonl`: append-only log;
- `control.sock`: control API with `GET /health`, `GET /status`, `POST /track`, `/untrack`, `/auto-merge`, `/review-requested`, `/hold` (`{repo, number}` or `{all: true}`, optional `durationMs`, `reason`), `/unhold`, `/resync`;
- `daemon.log`, `projects.json`.

