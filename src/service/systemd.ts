import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../daemon/runner.ts";
import { shellQuote, type ServiceManager, type ServiceSpec } from "./types.ts";

interface SystemdOptions {
  unitDir?: string;
  runner: CommandRunner;
}

const NEEDS_QUOTING = /[\s"\\]/u;
const QUOTED_SPECIALS = /["\\]/gu;

const escapeQuoted = (value: string) => value.replaceAll(QUOTED_SPECIALS, String.raw`\$&`);

const quoteArgument = (argument: string) =>
  NEEDS_QUOTING.test(argument) ? `"${escapeQuoted(argument)}"` : argument;

const environmentLines = (spec: ServiceSpec) =>
  Object.entries(spec.env)
    .map(([key, value]) => escapeQuoted(`${key}=${value}`))
    .map((assignment) => `Environment="${assignment}"`)
    .join("\n");

export function renderUnit(spec: ServiceSpec) {
  const execStart = spec.program.map(quoteArgument).join(" ");
  return `[Unit]
Description=pr-autopilot daemon
After=network-online.target

[Service]
ExecStart=${execStart}
${environmentLines(spec)}
Restart=always
RestartSec=10
StandardOutput=append:${spec.logPath}
StandardError=append:${spec.logPath}

[Install]
WantedBy=default.target
`;
}

export class SystemdService implements ServiceManager {
  readonly kind = "systemd";

  constructor(private readonly options: SystemdOptions) {}

  private get directory() {
    return this.options.unitDir ?? join(homedir(), ".config", "systemd", "user");
  }

  path(label: string) {
    return join(this.directory, `${label}.service`);
  }

  render(spec: ServiceSpec) {
    return renderUnit(spec);
  }

  async install(spec: ServiceSpec) {
    mkdirSync(this.directory, { recursive: true });
    const file = this.path(spec.label);
    writeFileSync(file, renderUnit(spec));
    const unit = shellQuote(`${spec.label}.service`);
    const command = `systemctl --user daemon-reload && systemctl --user enable --now ${unit}`;
    const result = await this.options.runner.run(command, {});
    if (result.code !== 0) throw new Error(`systemctl enable failed: ${result.stderr.trim()}`);
    return file;
  }

  async uninstall(label: string) {
    const unit = shellQuote(`${label}.service`);
    await this.options.runner.run(`systemctl --user disable --now ${unit}`, {});
    rmSync(this.path(label), { force: true });
  }
}
