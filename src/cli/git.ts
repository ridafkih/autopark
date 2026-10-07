export async function git(...args: string[]) {
  const result = await Bun.$`git ${args}`.quiet().nothrow();
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

export const gitRoot = async () => (await git("rev-parse", "--show-toplevel")) ?? process.cwd();
