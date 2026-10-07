# How it works

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

## Transitions

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

