import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/daemon/store.ts";

const CLI = join(resolve(import.meta.dir, ".."), "src/cli/main.ts");
const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function transitionLine(id: number, number: number) {
  const repo = "acme/widgets";
  const transition = {
    id,
    ts: "",
    kind: "checks_failed",
    repo,
    number,
    head: "1".repeat(40),
    reason: "required failed: build (FAILURE)",
    data: {},
    title: "T",
    url: `https://github.com/${repo}/pull/${number}`,
  };
  return `${JSON.stringify(transition)}\n`;
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "apl-watch-"));
  const home = join(directory, "home");
  const project = join(directory, "proj");
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  const config = "repos:\n  - acme/elsewhere\ndelivery:\n  monitor: always\n";
  writeFileSync(join(project, ".autopark.yaml"), config);
  const store = new Store(join(home, "state.db"));
  store.track({ repo: "acme/widgets", number: 7, source: "explicit", sessionId: "s1", now: 1 });
  store.track({ repo: "acme/widgets", number: 8, source: "explicit", sessionId: "s2", now: 1 });
  store.close();
  const log = join(home, "transitions.jsonl");
  writeFileSync(log, "");
  return { home, project, log };
}

test("watch outside the config's repos still prints PRs bound to its session", async () => {
  const { home, project, log } = setup();
  const subprocess = Bun.spawn([process.execPath, CLI, "watch"], {
    cwd: project,
    env: { ...process.env, AUTOPARK_HOME: home, CLAUDE_CODE_SESSION_ID: "s1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  stops.push(() => subprocess.kill());
  await subprocess.stderr.getReader().read();
  appendFileSync(log, transitionLine(1, 8));
  appendFileSync(log, transitionLine(2, 7));
  const { value } = await subprocess.stdout.getReader().read();
  expect(new TextDecoder().decode(value).trim()).toBe(
    "autopark acme/widgets#7 checks_failed head=1111111: required failed: build (FAILURE) https://github.com/acme/widgets/pull/7",
  );
});
