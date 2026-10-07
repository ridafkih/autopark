import type { Paths } from "../../daemon/paths.ts";

export interface Invocation {
  argv: string[];
  paths: Paths;
}

export type CommandHandler = (invocation: Invocation) => Promise<void> | void;
