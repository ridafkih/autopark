# The daemon

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

