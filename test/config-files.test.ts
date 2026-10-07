import { describe, expect, test } from "bun:test";
import { loadConfigFile, parseConfigText } from "../src/config/load.ts";
import { configJsonSchema } from "../src/config/schema.ts";
import { valueAt } from "../src/core/json.ts";

describe("config files", () => {
  test("yaml and json parse to the same config", () => {
    const yaml = parseConfigText(
      "repos:\n  - acme/widgets\nreadiness:\n  minApprovals: 2\n",
      "x.yaml",
    );
    const json = parseConfigText(
      '{"repos":["acme/widgets"],"readiness":{"minApprovals":2}}',
      "x.json",
    );
    expect(yaml).toEqual(json);
  });

  test("shipped example configs are valid", async () => {
    for (const name of ["examples/minimal.autopark.yaml", "examples/ando.autopark.yaml"]) {
      const result = await loadConfigFile(`${import.meta.dir}/../${name}`);
      if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.issues)}`);
    }
  });

  test("json schema is generated from the same definition", () => {
    const schema = configJsonSchema();
    expect(valueAt(schema, "type")).toBe("object");
    expect(valueAt(schema, "required")).toEqual(["repos"]);
    expect(valueAt(schema, "additionalProperties")).toBe(false);
    expect(valueAt(schema, "properties", "autoMerge", "properties", "method", "enum")).toEqual([
      "merge",
      "squash",
      "rebase",
    ]);
    expect(valueAt(schema, "properties", "daemon", "properties", "backoffMs", "default")).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000,
    ]);
  });
});
