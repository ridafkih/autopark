import {
  isNullableString,
  isNumber,
  isRecord,
  isString,
  parseJson,
  type JsonRecord,
} from "./json.ts";
import {
  TRANSITION_KINDS,
  type LoggedTransition,
  type Transition,
  type TransitionKind,
} from "./types.ts";

export const isTransitionKind = (value: unknown): value is TransitionKind =>
  TRANSITION_KINDS.some((kind) => kind === value);

export function toTransition(value: unknown): Transition | null {
  if (!isRecord(value)) return null;
  const { kind, repo, number, head, reason, data } = value;
  if (!isTransitionKind(kind) || !isString(repo) || !isNumber(number)) return null;
  if (!isNullableString(head) || !isString(reason) || !isRecord(data)) return null;
  return { ...value, kind, repo, number, head, reason, data };
}

function loggedFields(value: JsonRecord) {
  const { id, ts, title, url } = value;
  if (!isNumber(id) || !isString(ts) || !isString(title) || !isString(url)) return null;
  return { id, ts, title, url };
}

export function toLoggedTransition(value: unknown): LoggedTransition | null {
  const transition = toTransition(value);
  const logged = isRecord(value) ? loggedFields(value) : null;
  if (!transition || !logged) return null;
  return { ...transition, ...logged };
}

export function parseLoggedTransition(line: string): LoggedTransition | null {
  try {
    return toLoggedTransition(parseJson(line));
  } catch {
    return null;
  }
}
