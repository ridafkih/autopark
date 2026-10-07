<div align="center">
  <h1>Autopilot</h1>
  <p>Drive pull requests to ready, without babysitting them.</p>
  <p>Welcome to Autopilot. A Claude Code plugin that watches your pull requests through live GitHub events, and has Claude fix whatever is blocking them the moment it happens. Conflicts, failed checks, review comments, stale bases, all handled without you having to ask for a status update.</p>
  	<span>
		<a href="#quickstart">Quickstart</a>
		<span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
		<a href="#installation">Installation</a>
		<span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
		<a href="#usage">Usage</a>
		<span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
		<a href="#configuration">Configuration</a>
		<span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
		<a href="#contribute">Contribute</a>
	</span>
</div>
<hr>

## Quickstart

The quickest way to get set up is to let Claude Code do it. Open Claude Code in the repository you want Autopilot to watch, and paste the following.

```text
Set up Autopilot (https://github.com/ridafkih/autopilot) for this repository.

1. Check that I have Bun 1.2.21 or newer, the GitHub CLI logged in (`gh auth status`),
   and admin access to this repository. If anything is missing, tell me before installing it.
2. Clone the Autopilot repository to ~/autopilot if it isn't there already, and run
   `bun install` inside it.
3. Run `gh extension install cli/gh-webhook`.
4. From the root of this repository, run `~/autopilot/bin/pr-autopilot init`. Then fill in
   the generated .pr-autopilot.yaml using what you can learn from this repository:
   - the required check names, from a few recent pull requests (`gh pr checks`);
   - any review bots that leave a score, and the score we hold out for;
   - how many approvals we need, and which branches I usually open pull requests from.
   Run `~/autopilot/bin/pr-autopilot validate` until it passes.
5. Run `~/autopilot/bin/pr-autopilot doctor` and fix anything it reports.
6. Run `~/autopilot/bin/pr-autopilot daemon install` so the daemon survives reboots.
7. Run `claude plugin marketplace add ~/autopilot` and
   `claude plugin install pr-autopilot@pr-autopilot`.
8. Show me the config you wrote, then tell me to restart Claude Code with
   `claude --dangerously-load-development-channels plugin:pr-autopilot@pr-autopilot`.
```

Once you've restarted, ask for a change with `/pr-autopilot:ship`, and Claude takes it the rest of the way.

## Installation

If you'd rather set things up by hand, you'll need [Bun](https://bun.sh) 1.2.21 or newer, the [GitHub CLI](https://cli.github.com) logged in, and admin access to the repository you want to watch.

```bash
git clone https://github.com/ridafkih/autopilot.git ~/autopilot
cd ~/autopilot && bun install
gh extension install cli/gh-webhook
```

Then, from the root of your own repository, create a config and start the daemon.

```bash
~/autopilot/bin/pr-autopilot init
~/autopilot/bin/pr-autopilot doctor
~/autopilot/bin/pr-autopilot daemon install
```

Finally, add the plugin to Claude Code.

```bash
claude plugin marketplace add ~/autopilot
claude plugin install pr-autopilot@pr-autopilot
claude --dangerously-load-development-channels plugin:pr-autopilot@pr-autopilot
```

The channel flag lets Autopilot push events straight into your session. Without it, everything still works through the plugin's monitor, it's just a little less immediate.

## Usage

Ask for a change, and Claude implements it to your project's standards, opens the pull request, and starts following it.

```text
/pr-autopilot:ship add rate limiting to the export endpoint
```

From then on, Claude hears about everything that happens to that pull request as it happens, and deals with it.

```text
pr-autopilot acme/widgets#412 checks_failed head=3f9c2e1: required checks failed: test
pr-autopilot acme/widgets#412 head_moved head=8a71d0b: head moved 3f9c2e1 → 8a71d0b
pr-autopilot acme/widgets#412 review_scored head=8a71d0b: greptile scored 5/5 on head
pr-autopilot acme/widgets#412 ready head=8a71d0b: all readiness rules pass; mergeable now
```

When a pull request is ready, Claude lets you know and waits for you. Nothing merges unless you've opted that pull request into auto-merge.

You can also keep an eye on things yourself.

```bash
pr-autopilot status                  # every tracked pull request, and what's blocking it
pr-autopilot check acme/widgets#412  # read and evaluate one pull request right now
pr-autopilot track 412 --auto-merge  # follow an existing pull request, and merge it once it's ready
```

## Configuration

Autopilot reads `.pr-autopilot.yaml` from the root of your repository. The smallest useful config looks something like this.

```yaml
repos:
  - acme/widgets

track:
  authors: ["@me"]

reviewers:
  - name: greptile
    parser: greptile
    minScore: 5

readiness:
  minApprovals: 1
  baseFreshness:
    policy: contains-tip
```

Every option is covered in [docs/configuration.md](./docs/configuration.md), and `pr-autopilot schema` prints the JSON Schema if you'd like completion in your editor.

If you want to go further, there's more in the [docs/](./docs) folder.

- [How it works](./docs/how-it-works.md), and every event Claude can receive.
- [Extending](./docs/extending.md) with your own event sources, review bots, and playbook.
- [The daemon](./docs/daemon.md), and where it keeps its state.
- [Security](./docs/security.md), and the known limits.

## Contribute

Feel free to contribute to the repository. Pull requests and issues with feature requests are _super_ welcome!

```bash
bun install
bun test
bun run typecheck
bun run lint
bun run format:check
```

Every test is deterministic. Time comes from an injected clock, GitHub from a scripted fake, and webhooks from fixture payloads, so please keep it that way.

### Code style

`bun run lint` and `bun run format:check` need to pass before anything lands. The lint config is strict on purpose (no `let`, no one-letter names, small files and functions), so if it complains, it's usually nudging you toward a smaller helper rather than a disable comment.
