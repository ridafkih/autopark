export const USAGE = `autopark <command>

  init [--repo owner/name] [--force]      scaffold .autopark.yaml at the git root and register it
  validate [path]                         validate a config file
  register <path>                         add a config that lives outside its repo to the daemon's registry
  schema                                  print the config JSON Schema
  doctor                                  check gh auth and scopes, the webhook extension, the daemon and the channel
  check <pr> [--json]                     fetch and evaluate one PR now (read-only)
  status [--json] [--session id]          tracked PRs, what blocks them, how long, and any hold
  track <pr> [--session id] [--auto-merge]
  untrack <pr>
  auto-merge <pr> on|off|default
  request-review <pr>                     run the configured review request and record the head
  hold <pr|all> [--for 30m] [--reason "..."]   pause nudges and Stop-hook blocks (default 30m, at most 4h)
  unhold <pr|all>                         release a hold; "all" releases every hold
  daemon run|start|stop|status|install [--print]|uninstall   (run/start/install accept --config <path>, repeatable)
  hook session-start|stop                 Claude Code hook entry points (read hook JSON on stdin)
  watch                                   print transitions as they happen (plugin monitor)
  ship-context                            project settings for the /ship skill

<pr> is owner/repo#123, a PR URL, or 123 / #123 inside a configured repo.`;
