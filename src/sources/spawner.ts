import { linesOf } from "./lines.ts";
import type { Spawner } from "./types.ts";

export const bunSpawner: Spawner = (command, env) => {
  const subprocess = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    lines: linesOf(subprocess.stdout, subprocess.stderr),
    exited: subprocess.exited,
    kill: () => subprocess.kill(),
  };
};
