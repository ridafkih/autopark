export class CliError extends Error {}

export const print = (text: string) => {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};
