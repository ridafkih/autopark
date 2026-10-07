import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { bunSpawner } from "../sources/gh-webhook-forward.ts";
import { createSource } from "../sources/index.ts";
import type { Spawner } from "../sources/types.ts";
import type { Clock } from "./clock.ts";
import type { ConfigSet } from "./config-set.ts";

const SECRET_BYTES = 32;

export function createConfiguredSource(configs: ConfigSet, clock: Clock, spawn?: Spawner) {
  const { daemon } = configs;
  const secret = process.env[daemon.secretEnv] || randomBytes(SECRET_BYTES).toString("hex");
  return createSource(daemon.source.type, daemon.source.options, {
    clock,
    port: daemon.port,
    secret,
    spawn: spawn ?? bunSpawner,
    baseDir: dirname(configs.primary.source),
  });
}
