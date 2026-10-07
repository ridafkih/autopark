import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../daemon/runner.ts";
import { shq, type ServiceManager, type ServiceSpec } from "./types.ts";

const arg = (a: string) => (/[\s"\\]/.test(a) ? `"${a.replace(/["\\]/g, "\\$&")}"` : a);

export function renderUnit(spec: ServiceSpec) {
  const env = Object.entries(spec.env)
    .map(([k, v]) => `Environment="${`${k}=${v}`.replace(/["\\]/g, "\\$&")}"`)
    .join("\n");
  return `[Unit]
Description=pr-autopilot daemon
After=network-online.target

[Service]
ExecStart=${spec.program.map(arg).join(" ")}
${env}
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
  constructor(private o: { unitDir?: string; runner: CommandRunner }) {}

  private get dir() {
    return this.o.unitDir ?? join(homedir(), ".config", "systemd", "user");
  }

  path(label: string) {
    return join(this.dir, `${label}.service`);
  }

  render(spec: ServiceSpec) {
    return renderUnit(spec);
  }

  async install(spec: ServiceSpec) {
    mkdirSync(this.dir, { recursive: true });
    const file = this.path(spec.label);
    writeFileSync(file, renderUnit(spec));
    const r = await this.o.runner.run(
      `systemctl --user daemon-reload && systemctl --user enable --now ${shq(`${spec.label}.service`)}`,
      {},
    );
    if (r.code !== 0) throw new Error(`systemctl enable failed: ${r.stderr.trim()}`);
    return file;
  }

  async uninstall(label: string) {
    await this.o.runner.run(`systemctl --user disable --now ${shq(`${label}.service`)}`, {});
    rmSync(this.path(label), { force: true });
  }
}
