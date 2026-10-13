type Environment = Record<string, string | undefined>;

const SESSION_VARIABLES = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"];

export function sessionIdFrom(env: Environment): string | null {
  const ids = SESSION_VARIABLES.map((name) => env[name]);
  return ids.find((id): id is string => typeof id === "string" && id.length > 0) ?? null;
}
