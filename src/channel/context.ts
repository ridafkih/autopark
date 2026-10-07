import { findConfig, loadConfigFile } from "../config/load.ts";
import type { Config } from "../config/schema.ts";

export async function cwdConfig(
  cwd: string,
): Promise<{ config: Config | null; path: string | null }> {
  const path = findConfig(cwd);
  if (!path) return { config: null, path: null };
  try {
    const r = await loadConfigFile(path);
    return { config: r.ok ? r.config : null, path };
  } catch {
    return { config: null, path };
  }
}
