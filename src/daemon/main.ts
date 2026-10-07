import { parseArgs } from "node:util";
import { errorMessage } from "../core/errors.ts";
import { GitHubHttp } from "../github/client.ts";
import { ConfigSet } from "./config-set.ts";
import { logToStderr, startDaemon } from "./daemon.ts";
import { resolvePaths } from "./paths.ts";
import { readProjects } from "./projects.ts";

export async function runDaemon(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { config: { type: "string", multiple: true } },
    allowPositionals: false,
  });
  const paths = resolvePaths();
  const configPaths = [...new Set([...(values.config ?? []), ...readProjects(paths.projects)])];
  if (configPaths.length === 0) {
    throw new Error("no configs: run `autopark init` in a repo or pass --config");
  }
  const configs = await ConfigSet.load(configPaths);
  const daemon = await startDaemon({ configs, github: new GitHubHttp() });
  const repos = configs.repos().join(", ");
  logToStderr(`watching ${repos} via ${daemon.source.name}; control ${paths.socket}`);
  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  try {
    await runDaemon(process.argv.slice(2));
  } catch (error) {
    logToStderr(errorMessage(error));
    process.exit(1);
  }
}
