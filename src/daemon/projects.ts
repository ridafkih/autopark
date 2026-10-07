import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const writeProjects = (file: string, projects: string[]) =>
  writeFileSync(file, `${JSON.stringify(projects, null, 2)}\n`);

export function readProjects(file: string): string[] {
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((project): project is string => typeof project === "string");
  } catch {
    return [];
  }
}

export function addProject(file: string, configPath: string) {
  const absolutePath = resolve(configPath);
  const projects = readProjects(file);
  if (projects.includes(absolutePath)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeProjects(file, [...projects, absolutePath]);
  return true;
}

export function removeProject(file: string, configPath: string) {
  const absolutePath = resolve(configPath);
  const projects = readProjects(file);
  if (!projects.includes(absolutePath)) return false;
  writeProjects(
    file,
    projects.filter((project) => project !== absolutePath),
  );
  return true;
}
