import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSource } from "../src/sources/index.ts";
import { ReplaySource } from "../src/sources/replay.ts";
import { recordingContext, unspawnableDependencies } from "./fixtures/source-context.ts";

describe("replay source", () => {
  test("delivers inline and file deliveries in order", async () => {
    const directory = mkdtempSync(join(tmpdir(), "apl-"));
    const file = join(directory, "d.jsonl");
    writeFileSync(
      file,
      '{"id":"f1","event":"ping","payload":{}}\n\n{"id":"f2","event":"ping","payload":{}}\n',
    );
    const source = new ReplaySource({
      file,
      deliveries: [{ id: "i1", event: "ping", payload: {} }],
    });
    const recorder = recordingContext();
    await source.start(recorder.context);
    expect(recorder.deliveries.map((delivery) => delivery.id)).toEqual(["i1", "f1", "f2"]);
    source.reconnect("test");
    expect(recorder.reconnects).toEqual(["test"]);
    expect(source.status()).toMatchObject({ name: "replay", state: "connected" });
  });

  test("registry builds a replay source with a path relative to the config", async () => {
    const source = await createSource(
      "replay",
      { file: "x.jsonl" },
      unspawnableDependencies("/cfg"),
    );
    expect(source.name).toBe("replay");
  });

  test("unknown source ids fail loudly", async () => {
    await expect(createSource("smoke-signals", {}, unspawnableDependencies("/"))).rejects.toThrow(
      /smoke-signals/u,
    );
  });
});
