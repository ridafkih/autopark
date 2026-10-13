import { existsSync } from "node:fs";
import { join } from "node:path";
import { formatDuration } from "../../core/duration.ts";
import { daemonHealth } from "../../daemon/client.ts";
import type { Health } from "../../daemon/control.ts";
import type { Paths } from "../../daemon/paths.ts";
import { ROOT } from "../root.ts";
import { shell, type Check } from "./check.ts";

const WEBHOOK_EXTENSION = /gh-webhook|cli\/gh-webhook/u;

async function extensionCheck(): Promise<Check> {
  const extensions = await shell(["gh", "extension", "list"]);
  if (WEBHOOK_EXTENSION.test(extensions.output)) {
    return { level: "ok", name: "gh-webhook", detail: "installed" };
  }
  return {
    level: "fail",
    name: "gh-webhook",
    detail: "extension missing",
    hint: "gh extension install cli/gh-webhook",
  };
}

async function adminCheck(repo: string): Promise<Check> {
  const permission = await shell(["gh", "api", `repos/${repo}`, "--jq", ".permissions.admin"]);
  if (permission.output === "true") {
    return { level: "ok", name: `admin ${repo}`, detail: "can create the forwarding webhook" };
  }
  return {
    level: "warn",
    name: `admin ${repo}`,
    detail: "no admin permission",
    hint: "gh webhook forward needs repo admin; use another event source",
  };
}

export async function forwardingChecks(sources: Set<string>, repos: string[]) {
  if (!sources.has("gh-webhook-forward")) return [];
  const checks = [await extensionCheck()];
  for (const repo of repos) checks.push(await adminCheck(repo));
  return checks;
}

function activity(source: Health["source"], now: number) {
  if (source.state !== "connected") return [];
  const connected =
    typeof source.lastConnectedAt === "number"
      ? [`connected ${formatDuration(now - source.lastConnectedAt)} ago`]
      : [];
  if (source.lastDeliveryAt === undefined) return connected;
  const delivery =
    source.lastDeliveryAt === null
      ? "no delivery yet"
      : `last delivery ${formatDuration(now - source.lastDeliveryAt)} ago`;
  return [...connected, delivery];
}

export function daemonStatus(health: Health, now: number): Check {
  const { source } = health;
  const sourceDetail = source.detail ? ` (${source.detail})` : "";
  const parts = [`pid ${health.pid}`, `${source.name} ${source.state}${sourceDetail}`];
  return {
    level: source.state === "connected" ? "ok" : "warn",
    name: "daemon",
    detail: [...parts, ...activity(source, now)].join(", "),
  };
}

export async function daemonCheck(paths: Paths): Promise<Check> {
  const health = await daemonHealth(paths.socket);
  if (!health) {
    return {
      level: "warn",
      name: "daemon",
      detail: "not running",
      hint: "autopark daemon start (or daemon install)",
    };
  }
  return daemonStatus(health, Date.now());
}

export function channelCheck(): Check {
  const manifest = join(ROOT, ".claude-plugin", "plugin.json");
  return {
    level: "info",
    name: "channel",
    detail: existsSync(manifest) ? "plugin manifest present" : "plugin manifest missing",
    hint: "load with: claude --dangerously-load-development-channels plugin:autopark@<marketplace>",
  };
}
