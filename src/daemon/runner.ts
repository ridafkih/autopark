export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, env: Record<string, string>, stdin?: string): Promise<RunResult>;
}

export const shellRunner: CommandRunner = {
  async run(command, env, stdin) {
    const proc = Bun.spawn(["sh", "-c", command], {
      env: { ...process.env, ...env },
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  },
};
