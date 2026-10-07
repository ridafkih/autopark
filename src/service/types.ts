export interface ServiceSpec {
  label: string;
  program: string[];
  env: Record<string, string>;
  logPath: string;
}

export interface ServiceManager {
  readonly kind: string;
  render(spec: ServiceSpec): string;
  install(spec: ServiceSpec): Promise<string>;
  uninstall(label: string): Promise<void>;
  path(label: string): string;
}

export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
