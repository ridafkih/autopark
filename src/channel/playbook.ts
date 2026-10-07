import { dirname, resolve } from "node:path";
import type { Config } from "../config/schema.ts";

export function playbookRef(config: Config | null, configPath: string | null) {
  const playbook = config?.delivery.playbook;
  if (playbook && configPath) {
    return `the playbook at ${resolve(dirname(configPath), playbook)} (read it before acting)`;
  }
  return "the autopark:autopark skill (load it with the Skill tool before acting)";
}
