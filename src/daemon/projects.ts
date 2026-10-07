import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function readProjects(file: string): string[] {
  if (!existsSync(file)) return [];
  try {
    const list = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function addProject(file: string, configPath: string) {
  const abs = resolve(configPath);
  const list = readProjects(file);
  if (list.includes(abs)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...list, abs], null, 2) + "\n");
  return true;
}

export function removeProject(file: string, configPath: string) {
  const abs = resolve(configPath);
  const list = readProjects(file);
  if (!list.includes(abs)) return false;
  writeFileSync(
    file,
    JSON.stringify(
      list.filter((p) => p !== abs),
      null,
      2,
    ) + "\n",
  );
  return true;
}
