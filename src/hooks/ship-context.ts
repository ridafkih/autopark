import { join, resolve } from "node:path";
import type { Config } from "../config/schema.ts";
import type { Health } from "../daemon/control.ts";
import { configOrDefaults } from "./state.ts";

export interface ShipContextInput {
  config: Config | null;
  configPath: string | null;
  root: string;
  health: Health | null;
  exists: (path: string) => boolean;
}

function configLine({ config, configPath }: ShipContextInput) {
  if (!config) return "- Config: none found; run `pr-autopilot init` to create one";
  return `- Config: ${configPath} (${config.repos.join(", ")})`;
}

function standardsLines(input: ShipContextInput, config: Config) {
  const files = config.standards.files.map((file) => ({ file, path: resolve(input.root, file) }));
  const present = files.filter(({ path }) => input.exists(path)).map(({ path }) => path);
  const missing = files.filter(({ path }) => !input.exists(path)).map(({ file }) => file);
  const readLine =
    present.length > 0
      ? `- Read before implementing: ${present.join(", ")}`
      : "- Read before implementing: no standards files found";
  return [readLine, ...(missing.length > 0 ? [`- Not present: ${missing.join(", ")}`] : [])];
}

function skillsLine({ standards }: Config) {
  if (standards.skills.length === 0) return "- Load these skills first: none configured";
  return `- Load these skills first: ${standards.skills.join(", ")}`;
}

function templateLine(root: string, { standards }: Config) {
  if (!standards.prBodyTemplate) {
    return "- PR body template: none; match the conventions of recently merged PRs";
  }
  return `- PR body template: ${join(root, standards.prBodyTemplate)}`;
}

function reviewKind({ command, instruction }: Config["reviewRequest"]) {
  if (command && instruction) return "command and instruction";
  if (command) return "command";
  return instruction ? "instruction" : null;
}

function reviewLine({ reviewRequest }: Config) {
  const kind = reviewKind(reviewRequest);
  if (!kind) return "- Review request: none configured; ask the user who reviews";
  const verb = reviewRequest.instruction ? "shown" : "run";
  return `- Review request: ${kind} (${verb} by \`pr-autopilot request-review\`)`;
}

function autoMergeLine({ autoMerge }: Config) {
  if (autoMerge.default) return "- Auto-merge: on for every tracked PR";
  if (autoMerge.labels.length === 0) return "- Auto-merge: off unless the user asks";
  const labels = autoMerge.labels.join(", ");
  return `- Auto-merge: off unless the user asks or the PR has a label in [${labels}]`;
}

function daemonLine(health: Health | null) {
  if (!health) return "- Daemon: not running; start it with `pr-autopilot daemon start`";
  return `- Daemon: running (${health.source.name} ${health.source.state})`;
}

export function shipContext(input: ShipContextInput) {
  const config = configOrDefaults(input.config);
  return [
    configLine(input),
    ...standardsLines(input, config),
    skillsLine(config),
    templateLine(input.root, config),
    reviewLine(config),
    autoMergeLine(config),
    daemonLine(input.health),
  ].join("\n");
}
