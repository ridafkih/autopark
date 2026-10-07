import { dirname, resolve } from "node:path";
import type { Config } from "../config/schema.ts";

export function playbookRef(cfg: Config | null, configPath: string | null) {
  if (cfg?.delivery.playbook && configPath) return `the playbook at ${resolve(dirname(configPath), cfg.delivery.playbook)} (read it before acting)`;
  return "the pr-autopilot:pr-autopilot skill (load it with the Skill tool before acting)";
}
