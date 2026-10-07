export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString = (value: unknown): value is string => typeof value === "string";

export const isNumber = (value: unknown): value is number => typeof value === "number";

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

export const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export const valueAt = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);

export function stringAt(value: unknown, ...keys: string[]) {
  const found = valueAt(value, ...keys);
  return isString(found) ? found : undefined;
}

export function numberAt(value: unknown, ...keys: string[]) {
  const found = valueAt(value, ...keys);
  return isNumber(found) ? found : undefined;
}

export function arrayAt(value: unknown, ...keys: string[]): unknown[] {
  const found = valueAt(value, ...keys);
  return Array.isArray(found) ? found : [];
}

export const recordsAt = (value: unknown, ...keys: string[]) =>
  arrayAt(value, ...keys).filter(isRecord);

export const memberOf =
  <Member extends string>(members: readonly Member[]) =>
  (value: unknown): value is Member =>
    members.some((member) => member === value);

export const isArrayOf = <Item>(
  value: unknown,
  isItem: (entry: unknown) => entry is Item,
): value is Item[] => Array.isArray(value) && value.every((entry) => isItem(entry));

export const hasStrings = (record: JsonRecord, keys: string[]) =>
  keys.every((key) => isString(record[key]));

export const hasBooleans = (record: JsonRecord, keys: string[]) =>
  keys.every((key) => isBoolean(record[key]));
