import { shell, type Check } from "./check.ts";

const SCOPES_LINE = /Token scopes:\s*(.+)/u;
const QUOTES = /^'|'$/gu;
const HOOK_SCOPES = new Set(["repo", "admin:repo_hook", "write:repo_hook"]);

export function scopesFrom(authStatus: string): string[] {
  const [, scopes] = SCOPES_LINE.exec(authStatus) ?? [];
  if (scopes === undefined) return [];
  return scopes
    .split(",")
    .map((scope) => scope.trim().replaceAll(QUOTES, ""))
    .filter((scope) => scope !== "");
}

export const bunCheck = (): Check => ({ level: "ok", name: "bun", detail: Bun.version });

export async function ghCheck(): Promise<Check> {
  const version = await shell(["gh", "--version"]);
  if (version.code !== 0) {
    return { level: "fail", name: "gh", detail: "not found", hint: "install the GitHub CLI" };
  }
  const [firstLine = ""] = version.output.split("\n");
  return { level: "ok", name: "gh", detail: firstLine };
}

export async function authCheck(): Promise<Check> {
  const auth = await shell(["gh", "auth", "status"]);
  if (auth.code !== 0) {
    return { level: "fail", name: "gh auth", detail: "not logged in", hint: "gh auth login" };
  }
  const scopes = scopesFrom(auth.output);
  const canCreateHooks = scopes.some((scope) => HOOK_SCOPES.has(scope));
  return {
    level: canCreateHooks ? "ok" : "warn",
    name: "gh scopes",
    detail: scopes.join(", ") || "unknown",
    hint: canCreateHooks
      ? undefined
      : "gh auth refresh -s admin:repo_hook (needed to create the forwarding webhook)",
  };
}
