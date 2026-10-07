# Extending

## An event-source adapter

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

## A reviewer parser

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

## The playbook

How Claude reacts to each transition lives in one file, `skills/pr-autopilot/SKILL.md`. To change it for a project, write your own and set `delivery.playbook: ./docs/pr-playbook.md`. The channel instructions and both hooks then point at your file instead.

