import { describe, expect, test } from "bun:test";
import { loadConfigFile, parseConfigText } from "../src/config/load.ts";
import { configJsonSchema } from "../src/config/schema.ts";

interface JsonSchemaNode {
  type?: string;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchemaNode>;
  enum?: unknown[];
  default?: unknown;
}

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
    for (const name of ["examples/minimal.pr-autopilot.yaml", "examples/ando.pr-autopilot.yaml"]) {
      const result = await loadConfigFile(`${import.meta.dir}/../${name}`);
      if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.issues)}`);
    }
  });

  test("json schema is generated from the same definition", () => {
    const schema = configJsonSchema() as JsonSchemaNode;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["repos"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.autoMerge?.properties?.method?.enum).toEqual([
      "merge",
      "squash",
      "rebase",
    ]);
    expect(schema.properties?.daemon?.properties?.backoffMs?.default).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000,
    ]);
  });
});
