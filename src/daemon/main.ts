import { parseArgs } from "node:util";
import { GitHubHttp } from "../github/client.ts";
import { ConfigSet } from "./config-set.ts";
import { startDaemon } from "./daemon.ts";
import { paths } from "./paths.ts";
import { readProjects } from "./projects.ts";

export async function runDaemon(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { config: { type: "string", multiple: true } },
    allowPositionals: false,
  });
  const p = paths();
  const configPaths = [...new Set([...(values.config ?? []), ...readProjects(p.projects)])];
  if (!configPaths.length) {
    throw new Error("no configs: run `pr-autopilot init` in a repo or pass --config");
  }
  const configs = await ConfigSet.load(configPaths);
  const daemon = await startDaemon({ configs, github: new GitHubHttp() });
  console.error(
    `[pr-autopilotd] watching ${configs.repos().join(", ")} via ${daemon.source.name}; control ${p.socket}`,
  );
  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  runDaemon(process.argv.slice(2)).catch((e) => {
    console.error(`[pr-autopilotd] ${(e as Error).message}`);
    process.exit(1);
  });
}
