import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { configJsonSchema, defaultConfig, type Config } from "../config/schema.ts";
import { findConfig, loadConfigFile } from "../config/load.ts";
import { evaluate } from "../core/evaluate.ts";
import { formatSummaries, summarize, type PrSummary } from "../core/summary.ts";
import { prKey } from "../core/types.ts";
import { controlFetch, daemonHealth } from "../daemon/daemon.ts";
import { fetchSettled } from "../daemon/engine.ts";
import { systemClock } from "../daemon/clock.ts";
import { paths, type Paths } from "../daemon/paths.ts";
import { addProject, readProjects } from "../daemon/projects.ts";
import { shellRunner } from "../daemon/runner.ts";
import { transitionEnv } from "../daemon/notify.ts";
import { Store } from "../daemon/store.ts";
import { GitHubHttp } from "../github/client.ts";
import { loadParsers } from "../reviewers/index.ts";
import { SERVICE_LABEL, serviceFor } from "../service/index.ts";
import { parseRef, repoFromRemote, type PrRef } from "./ref.ts";
import { initTemplate } from "./template.ts";

export const ROOT = resolve(import.meta.dir, "../..");

const USAGE = `pr-autopilot <command>

  init [--repo owner/name] [--force]      scaffold .pr-autopilot.yaml at the git root and register it
  validate [path]                         validate a config file
  schema                                  print the config JSON Schema
  doctor                                  check gh auth and scopes, the webhook extension, the daemon and the channel
  check <pr> [--json]                     fetch and evaluate one PR now (read-only)
  status [--json] [--session id]          tracked PRs and what blocks them
  track <pr> [--session id] [--auto-merge]
  untrack <pr>
  auto-merge <pr> on|off|default
  request-review <pr>                     run the configured review request and record the head
  daemon run|start|stop|status|install [--print]|uninstall

<pr> is owner/repo#123, a PR URL, or 123 / #123 inside a configured repo.`;

class CliError extends Error {}
const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);

async function git(...args: string[]) {
  const r = await Bun.$`git ${args}`.quiet().nothrow();
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
}

async function projectContext() {
  const configPath = findConfig(process.cwd());
  const loaded = configPath ? await loadConfigFile(configPath) : null;
  if (loaded && !loaded.ok) throw new CliError(`${configPath}:\n${loaded.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  return { configPath, config: loaded?.ok ? loaded.config : null };
}

async function defaultRepo(config: Config | null) {
  if (config?.repos.length === 1) return config.repos[0]!;
  const remote = await git("remote", "get-url", "origin");
  return remote ? repoFromRemote(remote) : null;
}

async function resolveRef(input: string | undefined, config: Config | null): Promise<PrRef> {
  if (!input) throw new CliError("missing <pr>");
  return parseRef(input, await defaultRepo(config));
}

async function configFor(repo: string, p: Paths): Promise<{ config: Config; source: string | null }> {
  const candidates = [findConfig(process.cwd()), ...readProjects(p.projects)].filter((x): x is string => !!x);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const r = await loadConfigFile(path);
    if (r.ok && r.config.repos.some((x) => x.toLowerCase() === repo.toLowerCase())) return { config: r.config, source: path };
  }
  return { config: defaultConfig([repo]), source: null };
}

async function api(p: Paths, method: string, path: string, body?: unknown) {
  if (!(await daemonHealth(p.socket))) return null;
  const res = await controlFetch(p.socket, path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const json: any = await res.json();
  if (!res.ok) throw new CliError(json.error ?? `daemon returned ${res.status}`);
  return json;
}

function offlineStore(p: Paths) {
  return new Store(p.db);
}

async function loadStatus(p: Paths): Promise<{ daemon: string; prs: PrSummary[] }> {
  const health = await daemonHealth(p.socket);
  if (health) {
    const res: any = await api(p, "GET", "/status");
    return { daemon: `daemon: running (pid ${health.pid}, ${health.source.name} ${health.source.state})`, prs: res.prs };
  }
  if (!existsSync(p.db)) return { daemon: "daemon: not running (no state yet)", prs: [] };
  const store = new Store(p.db, { readonly: true });
  try {
    return { daemon: "daemon: not running (last known state)", prs: store.listPrs({ trackedOnly: true }).map(summarize) };
  } finally {
    store.close();
  }
}

async function cmdStatus(argv: string[], p: Paths) {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" }, session: { type: "string" }, repo: { type: "string" } } });
  const s = await loadStatus(p);
  let prs = s.prs;
  if (values.session) prs = prs.filter((x) => x.sessionId === values.session);
  if (values.repo) prs = prs.filter((x) => x.repo.toLowerCase() === values.repo!.toLowerCase());
  out(values.json ? JSON.stringify({ daemon: s.daemon, prs }, null, 2) : formatSummaries(prs, { daemon: s.daemon }));
}

async function cmdTrack(argv: string[], p: Paths) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { session: { type: "string" }, "auto-merge": { type: "boolean" } } });
  const { config } = await projectContext();
  const ref = await resolveRef(positionals[0], config);
  const body = { ...ref, sessionId: values.session ?? process.env.CLAUDE_SESSION_ID ?? null, autoMerge: values["auto-merge"] ? true : undefined };
  if (await api(p, "POST", "/track", body)) return out(`tracking ${ref.repo}#${ref.number}`);
  const store = offlineStore(p);
  store.track({ repo: ref.repo, number: ref.number, source: "explicit", sessionId: body.sessionId, now: Date.now() });
  if (body.autoMerge) store.setAutoMerge(prKey(ref.repo, ref.number), true);
  store.close();
  out(`tracking ${ref.repo}#${ref.number} (daemon not running; it will evaluate on start)`);
}

async function cmdUntrack(argv: string[], p: Paths) {
  const { config } = await projectContext();
  const ref = await resolveRef(argv[0], config);
  if (!(await api(p, "POST", "/untrack", ref))) {
    const store = offlineStore(p);
    store.setTracked(prKey(ref.repo, ref.number), false);
    store.close();
  }
  out(`untracked ${ref.repo}#${ref.number}`);
}

async function cmdAutoMerge(argv: string[], p: Paths) {
  const { config } = await projectContext();
  const ref = await resolveRef(argv[0], config);
  const mode = argv[1];
  const enabled = mode === "on" ? true : mode === "off" ? false : mode === "default" ? null : undefined;
  if (enabled === undefined) throw new CliError("usage: pr-autopilot auto-merge <pr> on|off|default");
  if (!(await api(p, "POST", "/auto-merge", { ...ref, enabled }))) {
    const store = offlineStore(p);
    if (!store.getPr(prKey(ref.repo, ref.number))) throw new CliError(`${ref.repo}#${ref.number} is not tracked`);
    store.setAutoMerge(prKey(ref.repo, ref.number), enabled);
    store.close();
  }
  out(`auto-merge ${mode} for ${ref.repo}#${ref.number}`);
}

async function fetchEvaluation(ref: PrRef, p: Paths) {
  const { config, source } = await configFor(ref.repo, p);
  const parsers = await loadParsers(config.reviewers, source ? dirname(source) : process.cwd());
  const gh = new GitHubHttp();
  let { snap, reads } = await fetchSettled(gh, systemClock, ref.repo, ref.number, config.daemon.backoffMs);
  if (config.readiness.baseFreshness.policy !== "off" && snap.baseSha && snap.state === "OPEN") {
    snap = { ...snap, baseComparison: await gh.compare(ref.repo, snap.headSha, snap.baseSha) };
  }
  return { evaluation: evaluate(snap, config, parsers, null), config, cost: gh.lastCost, reads };
}

async function cmdCheck(argv: string[], p: Paths) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean" } } });
  const { config } = await projectContext();
  const ref = await resolveRef(positionals[0], config);
  const { evaluation: e, cost, reads } = await fetchEvaluation(ref, p);
  if (values.json) return out(JSON.stringify(e, null, 2));
  const lines = [
    `${e.repo}#${e.number} ${e.title}`,
    `head ${e.headSha.slice(0, 10)}  state ${e.state}  mergeable ${e.mergeable}/${e.mergeStateStatus}  graphql cost ${cost ?? "?"} x ${reads} read(s)`,
    `ready ${e.ready}  mergeable now ${e.mergeableNow}  awaiting human ${e.awaitingHuman}`,
    `base ${e.baseRef}${e.base.sha ? ` @ ${e.base.sha.slice(0, 10)}` : ""}  freshness ${e.base.policy}${e.base.behindBy !== null ? ` (behind ${e.base.behindBy})` : ""}`,
    `checks: failed ${e.checks.failed.map((f) => `${f.name}${f.required ? "*" : ""}=${f.conclusion}`).join(", ") || "none"}; pending required ${e.checks.pendingRequired.join(", ") || "none"}; gates ${e.checks.gates.map((g) => `${g.name}=${g.conclusion}`).join(", ") || "none"}`,
    ...e.reviewers.map((r) => `reviewer ${r.name}: score ${r.score ?? "-"}${r.maxScore ? `/${r.maxScore}` : ""} on ${r.reviewedSha?.slice(0, 10) ?? "-"} (on head ${r.onHead}, reviews ${r.reviewsCount ?? "-"})`),
    `threads open ${e.threadsOpen}; approvals on head ${e.approvals.onHead.join(", ") || "none"}; stale ${e.approvals.stale.join(", ") || "none"}`,
    ...e.reasons.map((r) => `  - ${r.code}: ${r.detail}`),
  ];
  out(lines.join("\n"));
}

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

async function cmdRequestReview(argv: string[], p: Paths) {
  const { config: local } = await projectContext();
  const ref = await resolveRef(argv[0], local);
  const { config } = await configFor(ref.repo, p);
  const status = await loadStatus(p);
  let summary = status.prs.find((x) => x.repo.toLowerCase() === ref.repo.toLowerCase() && x.number === ref.number);
  let head = summary?.head ?? null;
  let title = summary?.title ?? "";
  let url = summary?.url ?? `https://github.com/${ref.repo}/pull/${ref.number}`;
  if (!head) {
    const { evaluation } = await fetchEvaluation(ref, p);
    head = evaluation.headSha;
    title = evaluation.title;
    url = evaluation.url;
  }
  const rr = config.reviewRequest;
  if (!rr.command && !rr.instruction) throw new CliError("no reviewRequest.command or reviewRequest.instruction configured");
  const vars = { repo: ref.repo, number: String(ref.number), url, title, head };
  if (rr.command) {
    const env = transitionEnv({ id: 0, ts: "", kind: "awaiting_human", repo: ref.repo, number: ref.number, head, reason: "review requested", data: {}, title, url });
    const r = await shellRunner.run(rr.command, env);
    if (r.stdout.trim()) out(r.stdout.trim());
    if (r.code !== 0) throw new CliError(`review request command exited ${r.code}: ${r.stderr.trim()}`);
  }
  if (rr.instruction) out(`Review request instruction: ${fill(rr.instruction, vars)}`);
  if (!(await api(p, "POST", "/review-requested", { ...ref, head }))) {
    const store = offlineStore(p);
    store.setReviewRequested(prKey(ref.repo, ref.number), head);
    store.close();
  }
  out(`recorded review request for ${ref.repo}#${ref.number} at ${head.slice(0, 7)}`);
}

async function cmdInit(argv: string[], p: Paths) {
  const { values } = parseArgs({ args: argv, options: { repo: { type: "string" }, force: { type: "boolean" } } });
  const root = (await git("rev-parse", "--show-toplevel")) ?? process.cwd();
  const file = join(root, ".pr-autopilot.yaml");
  if (existsSync(file) && !values.force) throw new CliError(`${file} exists; pass --force to overwrite`);
  const repo = values.repo ?? (await defaultRepo(null));
  if (!repo) throw new CliError("could not detect the GitHub repo; pass --repo owner/name");
  writeFileSync(file, initTemplate(repo));
  addProject(p.projects, file);
  out(`wrote ${file} and registered it in ${p.projects}`);
}

async function cmdValidate(argv: string[]) {
  const path = argv[0] ?? findConfig(process.cwd());
  if (!path) throw new CliError("no config found");
  const r = await loadConfigFile(path);
  if (!r.ok) throw new CliError(`${path}:\n${r.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  out(`${path}: ok (${r.config.repos.join(", ")})`);
}

function serviceSpec(p: Paths) {
  return {
    label: SERVICE_LABEL,
    program: [process.execPath, join(ROOT, "src/daemon/main.ts")],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "", PR_AUTOPILOT_HOME: p.home },
    logPath: p.daemonLog,
  };
}

async function cmdDaemon(argv: string[], p: Paths) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "run": {
      const { runDaemon } = await import("../daemon/main.ts");
      return runDaemon(rest);
    }
    case "start": {
      if (await daemonHealth(p.socket)) return out("daemon already running");
      mkdirSync(p.home, { recursive: true });
      const cmd = `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(ROOT, "src/daemon/main.ts"))} >> ${JSON.stringify(p.daemonLog)} 2>&1`;
      const proc = Bun.spawn(["sh", "-c", cmd], { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { ...process.env, PR_AUTOPILOT_HOME: p.home } });
      proc.unref();
      for (let i = 0; i < 50; i++) {
        if (await daemonHealth(p.socket)) return out(`daemon started (log ${p.daemonLog})`);
        await Bun.sleep(100);
      }
      throw new CliError(`daemon did not come up; see ${p.daemonLog}`);
    }
    case "stop": {
      const h = await daemonHealth(p.socket);
      if (!h) return out("daemon not running");
      process.kill(h.pid, "SIGTERM");
      const svc = serviceFor(process.platform, shellRunner);
      if (svc && existsSync(svc.path(SERVICE_LABEL))) out(`note: the ${svc.kind} service will restart it; use \`pr-autopilot daemon uninstall\` to stop it for good`);
      return out(`sent SIGTERM to ${h.pid}`);
    }
    case "status": {
      const h = await daemonHealth(p.socket);
      return out(h ? JSON.stringify(h, null, 2) : "daemon not running");
    }
    case "install": {
      const svc = serviceFor(process.platform, shellRunner);
      if (!svc) throw new CliError(`no service manager for ${process.platform}; run \`pr-autopilot daemon run\` under your supervisor`);
      if (rest.includes("--print")) return out(svc.render(serviceSpec(p)));
      return out(`installed ${svc.kind} service at ${await svc.install(serviceSpec(p))}`);
    }
    case "uninstall": {
      const svc = serviceFor(process.platform, shellRunner);
      if (!svc) throw new CliError(`no service manager for ${process.platform}`);
      await svc.uninstall(SERVICE_LABEL);
      return out(`removed ${svc.kind} service ${SERVICE_LABEL}`);
    }
  }
  throw new CliError("usage: pr-autopilot daemon run|start|stop|status|install [--print]|uninstall");
}

export async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const p = paths();
  switch (cmd) {
    case "status":
      return cmdStatus(rest, p);
    case "track":
      return cmdTrack(rest, p);
    case "untrack":
      return cmdUntrack(rest, p);
    case "auto-merge":
      return cmdAutoMerge(rest, p);
    case "request-review":
      return cmdRequestReview(rest, p);
    case "check":
      return cmdCheck(rest, p);
    case "init":
      return cmdInit(rest, p);
    case "validate":
      return cmdValidate(rest);
    case "schema":
      return out(JSON.stringify(configJsonSchema(), null, 2));
    case "doctor": {
      const { runDoctor } = await import("./doctor.ts");
      return runDoctor(p);
    }
    case "daemon":
      return cmdDaemon(rest, p);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return out(USAGE);
  }
  throw new CliError(`unknown command ${cmd}\n\n${USAGE}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`pr-autopilot: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
