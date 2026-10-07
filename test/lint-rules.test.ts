import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OXLINT = join(ROOT, "node_modules/.bin/oxlint");
const workspace = mkdtempSync(join(tmpdir(), "autopilot-lint-"));

interface Diagnostic {
  labels: Array<{ span: { line: number } }>;
}

const configFor = (rule: string) => ({
  jsPlugins: [join(ROOT, "lint/autopilot.ts")],
  categories: { correctness: "off" },
  rules: { [`autopilot/${rule}`]: "error" },
});

async function flaggedLines(rule: string, source: string) {
  const configPath = join(workspace, `${rule}.json`);
  const sourcePath = join(workspace, `${rule}.ts`);
  writeFileSync(configPath, JSON.stringify(configFor(rule)));
  writeFileSync(sourcePath, source);
  const result = await Bun.$`${OXLINT} -c ${configPath} -f json ${sourcePath}`.quiet().nothrow();
  const report = JSON.parse(result.stdout.toString()) as { diagnostics: Diagnostic[] };
  return report.diagnostics.map((diagnostic) => diagnostic.labels[0]?.span.line);
}

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("autopilot lint plugin", () => {
  test("no-let flags every let binding and leaves const alone", async () => {
    const source = [
      "export const kept = 1;",
      "let reassigned = 2;",
      "for (let index = 0; index < 2; index += 1) reassigned = index;",
    ].join("\n");
    expect(await flaggedLines("no-let", source)).toEqual([2, 3]);
  });

  test("simple-template-expressions allows values and single calls", async () => {
    const source = [
      "const sha = 'abc';",
      "const items = ['a'];",
      "export const plain = `${sha} ${items.length} ${sha.slice(0, 7)} ${String(sha)}`;",
    ].join("\n");
    expect(await flaggedLines("simple-template-expressions", source)).toEqual([]);
  });

  test("simple-template-expressions flags ternaries, nested templates, callbacks and chains", async () => {
    const source = [
      "const sha = 'abc';",
      "const items = ['a'];",
      "export const ternary = `${sha ? sha : '-'}`;",
      "export const nested = `${`${sha}`}`;",
      "export const mapped = `${items.map((item) => item)}`;",
      "export const chained = `${items.join(', ').trim()}`;",
    ].join("\n");
    expect(await flaggedLines("simple-template-expressions", source)).toEqual([3, 4, 5, 6]);
  });
});
