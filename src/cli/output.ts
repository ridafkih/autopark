export class CliError extends Error {}

export const note = (text: string) => {
  process.stderr.write(`autopark: ${text}\n`);
};

export const print = (text: string) => {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};
