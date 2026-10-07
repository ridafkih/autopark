import { existsSync } from "node:fs";
import { errorMessage } from "../../core/errors.ts";
import { daemonHealth } from "../../daemon/client.ts";
import { shipContext } from "../../hooks/ship-context.ts";
import { gitRoot } from "../git.ts";
import { print } from "../output.ts";
import { projectContext, type ProjectContext } from "../project.ts";
import type { Invocation } from "./types.ts";

async function projectContextOrEmpty(): Promise<ProjectContext> {
  try {
    return await projectContext();
  } catch {
    return { config: null, configPath: null };
  }
}

export async function printShipContext({ paths }: Invocation) {
  try {
    const { config, configPath } = await projectContextOrEmpty();
    const root = await gitRoot();
    const health = await daemonHealth(paths.socket);
    print(shipContext({ config, configPath, root, health, exists: existsSync }));
  } catch (error) {
    print(`- Context unavailable: ${errorMessage(error)}`);
  }
}
