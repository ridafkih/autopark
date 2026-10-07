export type Level = "ok" | "warn" | "fail" | "info";

export interface Check {
  level: Level;
  name: string;
  detail: string;
  hint?: string;
}

export async function shell(command: string[]) {
  const result = await Bun.$`${command}`.quiet().nothrow();
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
  return { code: result.exitCode, output };
}

export function formatCheck(check: Check) {
  const hint = check.hint ? `\n      -> ${check.hint}` : "";
  return `${check.level.padEnd(4)}  ${check.name}: ${check.detail}${hint}\n`;
}
