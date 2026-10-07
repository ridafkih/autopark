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
    const subprocess = Bun.spawn(["sh", "-c", command], {
      env: { ...process.env, ...env },
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    return { code, stdout, stderr };
  },
};
