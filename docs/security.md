# Security

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

