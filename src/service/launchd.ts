import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../daemon/runner.ts";
import { shq, type ServiceManager, type ServiceSpec } from "./types.ts";

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderPlist(spec: ServiceSpec) {
  const args = spec.program.map((a) => `    <string>${x(a)}</string>`).join("\n");
  const env = Object.entries(spec.env)
    .map(([k, v]) => `    <key>${x(k)}</key>\n    <string>${x(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${x(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${x(spec.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${x(spec.logPath)}</string>
</dict>
</plist>
`;
}

export class LaunchdService implements ServiceManager {
  readonly kind = "launchd";
  constructor(private o: { agentsDir?: string; uid?: number; runner: CommandRunner }) {}

  private get dir() {
    return this.o.agentsDir ?? join(homedir(), "Library", "LaunchAgents");
  }
  private get domain() {
    return `gui/${this.o.uid ?? process.getuid?.() ?? 501}`;
  }

  path(label: string) {
    return join(this.dir, `${label}.plist`);
  }

  render(spec: ServiceSpec) {
    return renderPlist(spec);
  }

  async install(spec: ServiceSpec) {
    mkdirSync(this.dir, { recursive: true });
    const file = this.path(spec.label);
    writeFileSync(file, renderPlist(spec));
    const r = await this.o.runner.run(`launchctl bootout ${this.domain}/${spec.label} 2>/dev/null; launchctl bootstrap ${this.domain} ${shq(file)}`, {});
    if (r.code !== 0) throw new Error(`launchctl bootstrap failed: ${r.stderr.trim()}`);
    return file;
  }

  async uninstall(label: string) {
    await this.o.runner.run(`launchctl bootout ${this.domain}/${label}`, {});
    rmSync(this.path(label), { force: true });
  }
}
