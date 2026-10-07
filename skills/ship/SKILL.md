---
name: ship
description: Take a task from request to a merge-ready pull request using the project's standards, then follow live PR events until it is ready, merged, or blocked on a human.
disable-model-invocation: true
argument-hint: <what to build or fix>
allowed-tools: Bash(git *) Bash(gh pr *) Bash(gh run *) Bash(pr-autopilot *)
---

# Ship: $ARGUMENTS

## Project settings

!`"${CLAUDE_PLUGIN_ROOT}/bin/pr-autopilot" ship-context`

`pr-autopilot` is on the Bash PATH through this plugin's `bin/`.

## Workflow

1. **Standards.** Read every file listed under "Read before implementing" in full, and load every skill under "Load these skills first" with the Skill tool. Where they disagree with your defaults, they win. If the project has no standards files, follow the conventions visible in recently merged code.
2. **Isolate.** Work in a fresh git worktree on a new branch cut from the up-to-date base, never in the user's checkout: `git fetch origin` then `git worktree add -b <branch> <dir> origin/<base>`. Name the branch to match the repo's conventions and any `track.branchPrefixes` in the config, so the daemon tracks it on its own.
3. **Tests first.** Write tests that pin the behavior and fail for the right reason, then implement until they pass. Run the project's own lint, typecheck and test commands before every push. Commit in small, reviewable steps using the repo's commit style.
4. **Open the PR.** Push, then `gh pr create`. Use the PR body template if one is listed; otherwise match recently merged PRs. Say what changed and why, and how it was verified.
5. **Register it.** `pr-autopilot track <pr-url> --session ${CLAUDE_SESSION_ID}`. Add `--auto-merge` only if the user asked for this PR to merge itself once ready.
6. **Request review.** `pr-autopilot request-review <pr-url>`. If it prints a review request instruction, carry it out once with your own tools. It records the head commit, so re-run it whenever the head moves and approval is needed again.
7. **Hand off to events.** Load the `pr-autopilot:pr-autopilot` skill now. From here every change to the PR arrives on its own as a pr-autopilot channel event or monitor line; react to each one with that playbook. Do not poll GitHub, loop on `gh pr checks`, or sleep. While checks or reviews are pending, end your turn. The Stop hook holds the turn open only when something is actionable.
8. **Finish.** On `ready`, tell the user once, with the link and what still needs a human. A PR opted into auto-merge merges itself. On `merged` or `closed`, remove the worktree and report the outcome in one line.
