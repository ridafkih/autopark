import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OXLINT = join(ROOT, "node_modules/.bin/oxlint");
const workspace = mkdtempSync(join(tmpdir(), "autopilot-lint-"));

interface Diagnostic {
  code: string;
  filename: string;
  labels: Array<{ span: { line: number } }>;
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
  jsPlugins: [join(ROOT, "lint/autopilot.ts")],
  categories: { correctness: "off" },
  rules: { "autopilot/no-let": "error", "autopilot/simple-template-expressions": "error" },
};

const diagnostics: Diagnostic[] = [];

function flaggedLines(sample: string, rule: string) {
  return diagnostics
    .filter((diagnostic) => basename(diagnostic.filename) === `${sample}.ts`)
    .filter((diagnostic) => diagnostic.code === `autopilot(${rule})`)
    .map((diagnostic) => diagnostic.labels[0]?.span.line)
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
  const report = JSON.parse(result.stdout.toString()) as { diagnostics: Diagnostic[] };
  diagnostics.push(...report.diagnostics);
});

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("autopilot lint plugin", () => {
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
