import {
  definedEntries,
  fail,
  typeName,
  withDefault,
  type Meta,
  type Schema,
  type Validator,
} from "./core.ts";

interface StringOptions extends Meta {
  default?: string;
  pattern?: RegExp;
  minLength?: number;
}

export function stringSchema(options: StringOptions = {}): Schema<string> {
  const { minLength, pattern } = options;
  const validator: Validator<string> = {
    parse(value, path, issues) {
      if (typeof value !== "string") {
        return fail(issues, path, `expected string, got ${typeName(value)}`);
      }
      if (minLength !== undefined && value.length < minLength) {
        return fail(issues, path, `must be at least ${minLength} characters`);
      }
      if (pattern && !pattern.test(value)) {
        return fail(issues, path, `must match ${pattern.source}`);
      }
      return value;
    },
    json: () => ({ type: "string", ...definedEntries({ pattern: pattern?.source, minLength }) }),
  };
  return withDefault(validator, options.default, options);
}

export function enumSchema<const Member extends string>(
  values: readonly Member[],
  options: Meta & { default?: Member } = {},
): Schema<Member> {
  const isMember = (value: unknown): value is Member =>
    typeof value === "string" && values.some((candidate) => candidate === value);
  const validator: Validator<Member> = {
    parse(value, path, issues) {
      if (!isMember(value)) return fail(issues, path, `must be one of ${values.join(", ")}`);
      return value;
    },
    json: () => ({ type: "string", enum: [...values] }),
  };
  return withDefault(validator, options.default, options);
}

interface NumberOptions extends Meta {
  default?: number;
  min?: number;
  max?: number;
  int?: boolean;
}

function numberIssue(value: number, { min, max, int: isInteger }: NumberOptions) {
  if (isInteger && !Number.isInteger(value)) return "must be an integer";
  if (min !== undefined && value < min) return `must be >= ${min}`;
  if (max !== undefined && value > max) return `must be <= ${max}`;
  return null;
}

export function numberSchema(options: NumberOptions = {}): Schema<number> {
  const validator: Validator<number> = {
    parse(value, path, issues) {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return fail(issues, path, `expected number, got ${typeName(value)}`);
      }
      const issue = numberIssue(value, options);
      return issue ? fail(issues, path, issue) : value;
    },
    json: () => ({
      type: options.int ? "integer" : "number",
      ...definedEntries({ minimum: options.min, maximum: options.max }),
    }),
  };
  return withDefault(validator, options.default, options);
}

export function booleanSchema(options: Meta & { default?: boolean } = {}): Schema<boolean> {
  const validator: Validator<boolean> = {
    parse(value, path, issues) {
      if (typeof value !== "boolean") {
        return fail(issues, path, `expected boolean, got ${typeName(value)}`);
      }
      return value;
    },
    json: () => ({ type: "boolean" }),
  };
  return withDefault(validator, options.default, options);
}
