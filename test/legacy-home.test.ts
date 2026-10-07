import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "../src/core/json.ts";
import { migrateLegacyHome } from "../src/daemon/legacy-home.ts";
import { resolvePaths } from "../src/daemon/paths.ts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "apl-legacy-"));
  const legacy = join(root, "legacy");
  const paths = resolvePaths(join(root, "home"));
  mkdirSync(legacy);
  writeFileSync(join(legacy, "state.db"), "db");
  writeFileSync(join(legacy, "ando.yaml"), "repos: [acme/widgets]\n");
  const projects = [join(legacy, "ando.yaml"), "/repo/.autopark.yaml"];
  writeFileSync(join(legacy, "projects.json"), JSON.stringify(projects));
  return { legacy, paths };
}

describe("legacy home migration", () => {
  test("moves the old state directory and rewrites registered paths inside it", () => {
    const { legacy, paths } = setup();
    expect(migrateLegacyHome(paths, legacy)).toEqual({ from: legacy, to: paths.home });
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(join(paths.home, "state.db"), "utf8")).toBe("db");
    expect(parseJson(readFileSync(paths.projects, "utf8"))).toEqual([
      join(paths.home, "ando.yaml"),
      "/repo/.autopark.yaml",
    ]);
  });

  test("leaves an existing new home alone", () => {
    const { legacy, paths } = setup();
    mkdirSync(paths.home);
    expect(migrateLegacyHome(paths, legacy)).toBeNull();
    expect(existsSync(join(legacy, "state.db"))).toBe(true);
    expect(existsSync(paths.projects)).toBe(false);
  });

  test("does nothing without a legacy directory", () => {
    const { legacy, paths } = setup();
    expect(migrateLegacyHome(paths, join(legacy, "missing"))).toBeNull();
    expect(existsSync(paths.home)).toBe(false);
  });
});
