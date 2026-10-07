import { errorMessage } from "../../core/errors.ts";
import { runHook } from "../../hooks/run.ts";
import { print } from "../output.ts";
import type { Invocation } from "./types.ts";

export async function runHookCommand({ argv }: Invocation) {
  const [kind] = argv;
  try {
    const output = await runHook(kind ?? "", await Bun.stdin.text());
    if (output) print(output);
  } catch (error) {
    process.stderr.write(`pr-autopilot hook ${kind}: ${errorMessage(error)}\n`);
  }
}
