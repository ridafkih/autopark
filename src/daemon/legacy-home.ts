import { existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Paths } from "./paths.ts";
import { readProjects, writeProjects } from "./projects.ts";

const LEGACY_DIRECTORY = ".pr-autopilot";

export interface LegacyMove {
  from: string;
  to: string;
}

function relocate(project: string, { from, to }: LegacyMove) {
  return project.startsWith(`${from}/`) ? `${to}${project.slice(from.length)}` : project;
}

export function migrateLegacyHome(paths: Paths, from: string): LegacyMove | null {
  if (existsSync(paths.home) || !existsSync(from)) return null;
  const move = { from, to: paths.home };
  mkdirSync(dirname(paths.home), { recursive: true });
  renameSync(from, paths.home);
  if (existsSync(paths.projects)) {
    const projects = readProjects(paths.projects).map((project) => relocate(project, move));
    writeProjects(paths.projects, projects);
  }
  return move;
}

export function migrateDefaultHome(paths: Paths, log: (message: string) => void) {
  if (process.env.AUTOPARK_HOME) return;
  const move = migrateLegacyHome(paths, join(homedir(), LEGACY_DIRECTORY));
  if (move) log(`moved ${move.from} to ${move.to}`);
}
