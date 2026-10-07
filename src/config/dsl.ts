export type Issue = { path: string; message: string };

export interface Schema<T> {
  parse(value: unknown, path: string, issues: Issue[]): T;
  json(): Record<string, unknown>;
  hasDefault: boolean;
}

type Meta = { description?: string };

const join = (base: string, key: string) => (base ? `${base}.${key}` : key);
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

function withDefault<T>(
  inner: Omit<Schema<T>, "hasDefault">,
  def: T | undefined,
  meta: Meta,
): Schema<T> {
  return {
    hasDefault: def !== undefined,
    parse(value, path, issues) {
      if (value === undefined && def !== undefined) return clone(def);
      return inner.parse(value, path, issues);
    },
    json() {
      const out: Record<string, unknown> = { ...inner.json() };
      if (def !== undefined) out.default = clone(def);
      if (meta.description) out.description = meta.description;
      return out;
    },
  };
}

function fail<T>(issues: Issue[], path: string, message: string): T {
  issues.push({ path, message });
  return undefined as T;
}

export function str(
  opts: Meta & { default?: string; pattern?: RegExp; minLength?: number } = {},
): Schema<string> {
  return withDefault(
    {
      parse(v, path, issues) {
        if (typeof v !== "string") return fail(issues, path, `expected string, got ${typeOf(v)}`);
        if (opts.minLength !== undefined && v.length < opts.minLength)
          return fail(issues, path, `must be at least ${opts.minLength} characters`);
        if (opts.pattern && !opts.pattern.test(v))
          return fail(issues, path, `must match ${opts.pattern.source}`);
        return v;
      },
      json: () => ({
        type: "string",
        ...(opts.pattern ? { pattern: opts.pattern.source } : {}),
        ...(opts.minLength !== undefined ? { minLength: opts.minLength } : {}),
      }),
    },
    opts.default,
    opts,
  );
}

export function oneOf<const T extends string>(
  values: readonly T[],
  opts: Meta & { default?: T } = {},
): Schema<T> {
  return withDefault(
    {
      parse(v, path, issues) {
        if (typeof v !== "string" || !values.includes(v as T))
          return fail(issues, path, `must be one of ${values.join(", ")}`);
        return v as T;
      },
      json: () => ({ type: "string", enum: [...values] }),
    },
    opts.default,
    opts,
  );
}

export function num(
  opts: Meta & { default?: number; min?: number; max?: number; int?: boolean } = {},
): Schema<number> {
  return withDefault(
    {
      parse(v, path, issues) {
        if (typeof v !== "number" || Number.isNaN(v))
          return fail(issues, path, `expected number, got ${typeOf(v)}`);
        if (opts.int && !Number.isInteger(v)) return fail(issues, path, "must be an integer");
        if (opts.min !== undefined && v < opts.min)
          return fail(issues, path, `must be >= ${opts.min}`);
        if (opts.max !== undefined && v > opts.max)
          return fail(issues, path, `must be <= ${opts.max}`);
        return v;
      },
      json: () => ({
        type: opts.int ? "integer" : "number",
        ...(opts.min !== undefined ? { minimum: opts.min } : {}),
        ...(opts.max !== undefined ? { maximum: opts.max } : {}),
      }),
    },
    opts.default,
    opts,
  );
}

export function bool(opts: Meta & { default?: boolean } = {}): Schema<boolean> {
  return withDefault(
    {
      parse(v, path, issues) {
        if (typeof v !== "boolean") return fail(issues, path, `expected boolean, got ${typeOf(v)}`);
        return v;
      },
      json: () => ({ type: "boolean" }),
    },
    opts.default,
    opts,
  );
}

export function nullable<T>(
  inner: Schema<T>,
  opts: Meta & { default?: T | null } = {},
): Schema<T | null> {
  return withDefault<T | null>(
    {
      parse(v, path, issues) {
        if (v === null) return null;
        return inner.parse(v, path, issues);
      },
      json: () => ({ anyOf: [inner.json(), { type: "null" }] }),
    },
    opts.default,
    opts,
  );
}

export function arr<T>(
  item: Schema<T>,
  opts: Meta & { default?: T[]; minItems?: number } = {},
): Schema<T[]> {
  return withDefault(
    {
      parse(v, path, issues) {
        if (!Array.isArray(v)) return fail(issues, path, `expected array, got ${typeOf(v)}`);
        if (opts.minItems !== undefined && v.length < opts.minItems)
          return fail(issues, path, `must have at least ${opts.minItems} item(s)`);
        return v.map((x, i) => item.parse(x, `${path}[${i}]`, issues));
      },
      json: () => ({
        type: "array",
        items: item.json(),
        ...(opts.minItems !== undefined ? { minItems: opts.minItems } : {}),
      }),
    },
    opts.default,
    opts,
  );
}

export function anyRecord(
  opts: Meta & { default?: Record<string, unknown> } = {},
): Schema<Record<string, unknown>> {
  return withDefault(
    {
      parse(v, path, issues) {
        if (typeof v !== "object" || v === null || Array.isArray(v))
          return fail(issues, path, `expected object, got ${typeOf(v)}`);
        return v as Record<string, unknown>;
      },
      json: () => ({ type: "object" }),
    },
    opts.default,
    opts,
  );
}

type Shape = Record<string, Schema<any>>;
type Out<S extends Shape> = { [K in keyof S]: S[K] extends Schema<infer T> ? T : never };

export function obj<S extends Shape>(
  shape: S,
  opts: Meta & { optional?: boolean } = {},
): Schema<Out<S>> {
  const keys = Object.keys(shape);
  const required = keys.filter((k) => !shape[k]!.hasDefault);
  const allDefaulted = required.length === 0;
  return {
    hasDefault: allDefaulted,
    parse(v, path, issues) {
      if (v === undefined && allDefaulted) v = {};
      if (typeof v !== "object" || v === null || Array.isArray(v))
        return fail(issues, path || "(root)", `expected object, got ${typeOf(v)}`);
      const input = v as Record<string, unknown>;
      for (const k of Object.keys(input)) {
        if (!(k in shape)) issues.push({ path: join(path, k), message: "unknown key" });
      }
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const p = join(path, k);
        if (input[k] === undefined && !shape[k]!.hasDefault) {
          issues.push({ path: p, message: "is required" });
          continue;
        }
        out[k] = shape[k]!.parse(input[k], p, issues);
      }
      return out as Out<S>;
    },
    json() {
      const properties: Record<string, unknown> = {};
      for (const k of keys) properties[k] = shape[k]!.json();
      return {
        type: "object",
        ...(opts.description ? { description: opts.description } : {}),
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
    },
  };
}
