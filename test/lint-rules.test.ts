import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { arrayAt, numberAt, parseJson, stringAt } from "../src/core/json.ts";

const ROOT = resolve(import.meta.dir, "..");
const OXLINT = join(ROOT, "node_modules/.bin/oxlint");
const workspace = mkdtempSync(join(tmpdir(), "autopark-lint-"));

interface Diagnostic {
  code: string;
  filename: string;
  line: number | undefined;
}

function toDiagnostics(value: unknown): Diagnostic[] {
  const code = stringAt(value, "code");
  const filename = stringAt(value, "filename");
  if (code === undefined || filename === undefined) return [];
  const [label] = arrayAt(value, "labels");
  return [{ code, filename, line: numberAt(label, "span", "line") }];
}

const SAMPLES: Record<string, string[]> = {
  "let-bindings": [
    "export const kept = 1;",
    "let reassigned = 2;",
    "for (let index = 0; index < 2; index += 1) reassigned = index;",
  ],
  "simple-templates": [
    "const sha = 'abc';",
    "const items = ['a'];",
    "export const plain = `${sha} ${items.length} ${sha.slice(0, 7)} ${String(sha)}`;",
  ],
  "complex-templates": [
    "const sha = 'abc';",
    "const items = ['a'];",
    "export const ternary = `${sha ? sha : '-'}`;",
    "export const nested = `${`${sha}`}`;",
    "export const mapped = `${items.map((item) => item)}`;",
    "export const chained = `${items.join(', ').trim()}`;",
  ],
};

const config = {
  jsPlugins: [join(ROOT, "lint/autopark.ts")],
  categories: { correctness: "off" },
  rules: { "autopark/no-let": "error", "autopark/simple-template-expressions": "error" },
};

const diagnostics: Diagnostic[] = [];

function flaggedLines(sample: string, rule: string) {
  return diagnostics
    .filter((diagnostic) => basename(diagnostic.filename) === `${sample}.ts`)
    .filter((diagnostic) => diagnostic.code === `autopark(${rule})`)
    .map((diagnostic) => diagnostic.line)
    .toSorted();
}

beforeAll(async () => {
  const configPath = join(workspace, "oxlintrc.json");
  writeFileSync(configPath, JSON.stringify(config));
  for (const [name, lines] of Object.entries(SAMPLES)) {
    writeFileSync(join(workspace, `${name}.ts`), lines.join("\n"));
  }
  const result =
    await Bun.$`${process.execPath} --bun ${OXLINT} -c ${configPath} -f json --threads=1 ${workspace}`
      .quiet()
      .nothrow();
  const report = parseJson(result.stdout.toString());
  diagnostics.push(...arrayAt(report, "diagnostics").flatMap(toDiagnostics));
});

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("autopark lint plugin", () => {
  test("no-let flags every let binding and leaves const alone", () => {
    expect(flaggedLines("let-bindings", "no-let")).toEqual([2, 3]);
  });

  test("simple-template-expressions allows values and single calls", () => {
    expect(flaggedLines("simple-templates", "simple-template-expressions")).toEqual([]);
  });

  test("simple-template-expressions flags ternaries, nested templates, callbacks and chains", () => {
    const lines = flaggedLines("complex-templates", "simple-template-expressions");
    expect(lines).toEqual([3, 4, 5, 6]);
  });
});
