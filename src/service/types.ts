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

const ESCAPED_SINGLE_QUOTE = String.raw`'\''`;

export const shellQuote = (value: string) => `'${value.replaceAll("'", ESCAPED_SINGLE_QUOTE)}'`;
