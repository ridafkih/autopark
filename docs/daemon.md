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
- `autopark daemon run|start|install --config path` (repeatable) adds configs that live outside a repo; `daemon run` stays in the foreground for any other supervisor.

State lives in `~/.autopark` (override with `AUTOPARK_HOME`):
- `state.db`: sqlite holding deliveries, PRs, evaluations and transitions;
- `transitions.jsonl`: append-only log;
- `control.sock`: control API with `GET /health`, `GET /status`, `POST /track`, `/untrack`, `/auto-merge`, `/review-requested`, `/resync`;
- `daemon.log`, `projects.json`.

