import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../daemon/runner.ts";
import { shellQuote, type ServiceManager, type ServiceSpec } from "./types.ts";

interface LaunchdOptions {
  agentsDir?: string;
  uid?: number;
  runner: CommandRunner;
}

const FALLBACK_UID = 501;

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const programLines = (spec: ServiceSpec) =>
  spec.program.map((argument) => `    <string>${escapeXml(argument)}</string>`).join("\n");

const environmentLines = (spec: ServiceSpec) =>
  Object.entries(spec.env)
    .map(
      ([key, value]) =>
        `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`,
    )
    .join("\n");

export function renderPlist(spec: ServiceSpec) {
  const label = escapeXml(spec.label);
  const logPath = escapeXml(spec.logPath);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${programLines(spec)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentLines(spec)}
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
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

export class LaunchdService implements ServiceManager {
  readonly kind = "launchd";

  constructor(private readonly options: LaunchdOptions) {}

  private get directory() {
    return this.options.agentsDir ?? join(homedir(), "Library", "LaunchAgents");
  }

  private get domain() {
    const uid = this.options.uid ?? process.getuid?.() ?? FALLBACK_UID;
    return `gui/${uid}`;
  }

  path(label: string) {
    return join(this.directory, `${label}.plist`);
  }

  render(spec: ServiceSpec) {
    return renderPlist(spec);
  }

  async install(spec: ServiceSpec) {
    mkdirSync(this.directory, { recursive: true });
    const file = this.path(spec.label);
    writeFileSync(file, renderPlist(spec));
    const bootout = `launchctl bootout ${this.domain}/${spec.label} 2>/dev/null`;
    const bootstrap = `launchctl bootstrap ${this.domain} ${shellQuote(file)}`;
    const result = await this.options.runner.run(`${bootout}; ${bootstrap}`, {});
    if (result.code !== 0) throw new Error(`launchctl bootstrap failed: ${result.stderr.trim()}`);
    return file;
  }

  async uninstall(label: string) {
    await this.options.runner.run(`launchctl bootout ${this.domain}/${label}`, {});
    rmSync(this.path(label), { force: true });
  }
}
