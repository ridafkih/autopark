import { cwdConfig } from "../channel/context.ts";
import { monitorLine } from "../channel/meta.ts";
import { ancestorArgs, channelLoaded, inScope, monitorShouldEmit } from "../channel/scope.ts";
import { LogTailer } from "../channel/tail.ts";
import type { LoggedTransition } from "../core/types.ts";
import type { Paths } from "../daemon/paths.ts";

export async function runWatch(p: Paths) {
  const { config } = await cwdConfig(process.cwd());
  const mode = config?.delivery.monitor ?? "auto";
  const emit = monitorShouldEmit(mode, config?.delivery.channel ?? true, mode === "auto" ? channelLoaded(ancestorArgs()) : false);
  if (!emit) {
    process.stderr.write(`pr-autopilot watch: silent (monitor=${mode}${mode === "auto" ? ", channel loaded" : ""})\n`);
    await new Promise(() => {});
  }
  const scope = { repos: config?.repos ?? null };
  const tailer = new LogTailer(p.log, (line) => {
    try {
      const t = JSON.parse(line) as LoggedTransition;
      if (inScope(t, scope)) process.stdout.write(`${monitorLine(t)}\n`);
    } catch {}
  });
  tailer.start();
  process.stderr.write(`pr-autopilot watch: tailing ${p.log}\n`);
  await new Promise(() => {});
}
