export interface Issue {
  path: string;
  message: string;
}

export interface Schema<Value> {
  parse(value: unknown, path: string, issues: Issue[]): Value;
  json(): Record<string, unknown>;
  hasDefault: boolean;
}

export interface Meta {
  description?: string;
}

export type Validator<Value> = Omit<Schema<Value>, "hasDefault">;

const cloneValue = <Value>(value: Value): Value =>
  value === undefined ? value : structuredClone(value);

export const joinPath = (base: string, key: string) => (base ? `${base}.${key}` : key);

export const definedEntries = (entries: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function typeName(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

export function fail<Value>(issues: Issue[], path: string, message: string): Value {
  issues.push({ path, message });
  return undefined as Value;
}

export function withDefault<Value>(
  validator: Validator<Value>,
  defaultValue: Value | undefined,
  meta: Meta,
): Schema<Value> {
  return {
    hasDefault: defaultValue !== undefined,
    parse(value, path, issues) {
      if (value === undefined && defaultValue !== undefined) return cloneValue(defaultValue);
      return validator.parse(value, path, issues);
    },
    json: () => ({
      ...validator.json(),
      ...definedEntries({ default: cloneValue(defaultValue) }),
      ...(meta.description ? { description: meta.description } : {}),
    }),
  };
}
