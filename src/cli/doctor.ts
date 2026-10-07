import { existsSync } from "node:fs";
import { join } from "node:path";
import { findConfig, loadConfigFile } from "../config/load.ts";
import { daemonHealth } from "../daemon/client.ts";
import type { Paths } from "../daemon/paths.ts";
import { readProjects } from "../daemon/projects.ts";
import { ROOT } from "./main.ts";

type Level = "ok" | "warn" | "fail" | "info";
interface Check {
  level: Level;
  name: string;
  detail: string;
  hint?: string;
}

async function sh(cmd: string[]) {
  const r = await Bun.$`${cmd}`.quiet().nothrow();
  return { code: r.exitCode, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim() };
}

export function scopesFrom(authStatus: string): string[] {
  const m = /Token scopes:\s*(.+)/.exec(authStatus);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

export async function runDoctor(p: Paths) {
  const checks: Check[] = [];
  checks.push({ level: "ok", name: "bun", detail: Bun.version });

  const ghv = await sh(["gh", "--version"]);
  checks.push(
    ghv.code === 0
      ? { level: "ok", name: "gh", detail: ghv.out.split("\n")[0]! }
      : { level: "fail", name: "gh", detail: "not found", hint: "install the GitHub CLI" },
  );

  const auth = await sh(["gh", "auth", "status"]);
  const scopes = scopesFrom(auth.out);
  if (auth.code !== 0) {
    checks.push({ level: "fail", name: "gh auth", detail: "not logged in", hint: "gh auth login" });
  } else {
    const hookScope = scopes.some(
      (s) => s === "repo" || s === "admin:repo_hook" || s === "write:repo_hook",
    );
    checks.push({
      level: hookScope ? "ok" : "warn",
      name: "gh scopes",
      detail: scopes.join(", ") || "unknown",
      hint: hookScope
        ? undefined
        : "gh auth refresh -s admin:repo_hook (needed to create the forwarding webhook)",
    });
  }

  const configPaths = [
    ...new Set(
      [findConfig(process.cwd()), ...readProjects(p.projects)].filter(
        (x): x is string => !!x && existsSync(x),
      ),
    ),
  ];
  const sources = new Set<string>();
  const repos: string[] = [];
  if (!configPaths.length) {
    checks.push({ level: "fail", name: "config", detail: "none found", hint: "pr-autopilot init" });
  }
  for (const path of configPaths) {
    const r = await loadConfigFile(path);
    if (!r.ok) {
      checks.push({
        level: "fail",
        name: "config",
        detail: `${path}: ${r.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
      });
      continue;
    }
    sources.add(r.config.daemon.source.type);
    repos.push(...r.config.repos);
    checks.push({ level: "ok", name: "config", detail: `${path} (${r.config.repos.join(", ")})` });
    if (!readProjects(p.projects).includes(path)) {
      checks.push({
        level: "warn",
        name: "registry",
        detail: `${path} is not registered`,
        hint: "pr-autopilot init --force, or pass --config to the daemon",
      });
    }
  }

  if (sources.has("gh-webhook-forward")) {
    const ext = await sh(["gh", "extension", "list"]);
    const has = /gh-webhook|cli\/gh-webhook/.test(ext.out);
    checks.push(
      has
        ? { level: "ok", name: "gh-webhook", detail: "installed" }
        : {
            level: "fail",
            name: "gh-webhook",
            detail: "extension missing",
            hint: "gh extension install cli/gh-webhook",
          },
    );
    for (const repo of repos) {
      const perm = await sh(["gh", "api", `repos/${repo}`, "--jq", ".permissions.admin"]);
      checks.push(
        perm.out === "true"
          ? { level: "ok", name: `admin ${repo}`, detail: "can create the forwarding webhook" }
          : {
              level: "warn",
              name: `admin ${repo}`,
              detail: "no admin permission",
              hint: "gh webhook forward needs repo admin; use another event source",
            },
      );
    }
  }

  const health = await daemonHealth(p.socket);
  checks.push(
    health
      ? {
          level: health.source.state === "connected" ? "ok" : "warn",
          name: "daemon",
          detail: `pid ${health.pid}, ${health.source.name} ${health.source.state}${health.source.detail ? ` (${health.source.detail})` : ""}`,
        }
      : {
          level: "warn",
          name: "daemon",
          detail: "not running",
          hint: "pr-autopilot daemon start (or daemon install)",
        },
  );

  const manifest = join(ROOT, ".claude-plugin", "plugin.json");
  checks.push({
    level: "info",
    name: "channel",
    detail: existsSync(manifest) ? "plugin manifest present" : "plugin manifest missing",
    hint: "load with: claude --dangerously-load-development-channels plugin:pr-autopilot@<marketplace>",
  });

  for (const c of checks) {
    process.stdout.write(
      `${c.level.padEnd(4)}  ${c.name}: ${c.detail}${c.hint ? `\n      -> ${c.hint}` : ""}\n`,
    );
  }
  if (checks.some((c) => c.level === "fail")) process.exitCode = 1;
}
