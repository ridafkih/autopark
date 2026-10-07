import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogTailer } from "../src/channel/tail.ts";

const transitionsPath = () => join(mkdtempSync(join(tmpdir(), "apl-tail-")), "transitions.jsonl");

function tailFile(content = "") {
  const path = transitionsPath();
  writeFileSync(path, content);
  const lines: string[] = [];
  const tailer = new LogTailer(path, (line) => lines.push(line), { watch: false });
  return { path, lines, tailer };
}

describe("log tailer", () => {
  test("starts at the end so old transitions are not replayed", () => {
    const tail = tailFile('{"id":1}\n');
    tail.tailer.start();
    appendFileSync(tail.path, '{"id":2}\n');
    tail.tailer.poll();
    expect(tail.lines).toEqual(['{"id":2}']);
  });

  test("holds a partial line until it is complete", () => {
    const tail = tailFile();
    tail.tailer.start();
    appendFileSync(tail.path, '{"id":3');
    tail.tailer.poll();
    expect(tail.lines).toEqual([]);
    appendFileSync(tail.path, '}\n{"id":4}\n');
    tail.tailer.poll();
    expect(tail.lines).toEqual(['{"id":3}', '{"id":4}']);
  });

  test("a truncated file is read again from the start", () => {
    const tail = tailFile('{"id":1}\n{"id":2}\n');
    tail.tailer.start();
    truncateSync(tail.path, 0);
    appendFileSync(tail.path, '{"id":9}\n');
    tail.tailer.poll();
    expect(tail.lines).toEqual(['{"id":9}']);
  });

  test("a missing file is picked up once it appears", () => {
    const path = transitionsPath();
    const lines: string[] = [];
    const tailer = new LogTailer(path, (line) => lines.push(line), { watch: false });
    tailer.start();
    writeFileSync(path, '{"id":1}\n');
    tailer.poll();
    expect(lines).toEqual(['{"id":1}']);
  });
});
