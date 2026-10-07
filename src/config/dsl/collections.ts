import {
  definedEntries,
  fail,
  isRecord,
  joinPath,
  typeName,
  withDefault,
  type Issue,
  type Meta,
  type Schema,
  type Validator,
} from "./core.ts";

type Shape = Record<string, Schema<unknown>>;
type Parsed<Fields extends Shape> = {
  [Key in keyof Fields]: Fields[Key] extends Schema<infer Value> ? Value : never;
};

export function nullableSchema<Value>(
  inner: Schema<Value>,
  options: Meta & { default?: Value | null } = {},
): Schema<Value | null> {
  const validator: Validator<Value | null> = {
    parse: (value, path, issues) => (value === null ? null : inner.parse(value, path, issues)),
    json: () => ({ anyOf: [inner.json(), { type: "null" }] }),
  };
  return withDefault(validator, options.default, options);
}

export function arraySchema<Value>(
  item: Schema<Value>,
  options: Meta & { default?: Value[]; minItems?: number } = {},
): Schema<Value[]> {
  const { minItems } = options;
  const validator: Validator<Value[]> = {
    parse(value, path, issues) {
      if (!Array.isArray(value)) {
        return fail(issues, path, `expected array, got ${typeName(value)}`);
      }
      if (minItems !== undefined && value.length < minItems) {
        return fail(issues, path, `must have at least ${minItems} item(s)`);
      }
      return value.map((entry, index) => item.parse(entry, `${path}[${index}]`, issues));
    },
    json: () => ({ type: "array", items: item.json(), ...definedEntries({ minItems }) }),
  };
  return withDefault(validator, options.default, options);
}

export function recordSchema(
  options: Meta & { default?: Record<string, unknown> } = {},
): Schema<Record<string, unknown>> {
  const validator: Validator<Record<string, unknown>> = {
    parse(value, path, issues) {
      if (!isRecord(value)) return fail(issues, path, `expected object, got ${typeName(value)}`);
      return value;
    },
    json: () => ({ type: "object" }),
  };
  return withDefault(validator, options.default, options);
}

function reportUnknownKeys(input: Record<string, unknown>, shape: Shape, path: string) {
  return Object.keys(input)
    .filter((key) => !(key in shape))
    .map((key) => ({ path: joinPath(path, key), message: "unknown key" }));
}

function parseFields(shape: Shape, input: Record<string, unknown>, path: string, issues: Issue[]) {
  const fields = Object.entries(shape).flatMap(([key, schema]) => {
    const fieldPath = joinPath(path, key);
    if (input[key] === undefined && !schema.hasDefault) {
      issues.push({ path: fieldPath, message: "is required" });
      return [];
    }
    return [[key, schema.parse(input[key], fieldPath, issues)] as const];
  });
  return Object.fromEntries(fields);
}

export function objectSchema<Fields extends Shape>(
  shape: Fields,
  meta: Meta = {},
): Schema<Parsed<Fields>> {
  const required = Object.entries(shape)
    .filter(([, schema]) => !schema.hasDefault)
    .map(([key]) => key);
  const isAllDefaulted = required.length === 0;
  return {
    hasDefault: isAllDefaulted,
    parse(value, path, issues) {
      const input = value === undefined && isAllDefaulted ? {} : value;
      if (!isRecord(input)) {
        return fail(issues, path || "(root)", `expected object, got ${typeName(input)}`);
      }
      issues.push(...reportUnknownKeys(input, shape, path));
      return parseFields(shape, input, path, issues) as Parsed<Fields>;
    },
    json: () => ({
      type: "object",
      ...(meta.description ? { description: meta.description } : {}),
      properties: Object.fromEntries(
        Object.entries(shape).map(([key, schema]) => [key, schema.json()]),
      ),
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    }),
  };
}
