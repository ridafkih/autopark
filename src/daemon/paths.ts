import { homedir } from "node:os";
import { join } from "node:path";

export function homeDir() {
  return process.env.PR_AUTOPILOT_HOME || join(homedir(), ".pr-autopilot");
}

export function paths(home = homeDir()) {
  return {
    home,
    db: join(home, "state.db"),
    log: join(home, "transitions.jsonl"),
    socket: join(home, "control.sock"),
    pid: join(home, "daemon.pid"),
    daemonLog: join(home, "daemon.log"),
    projects: join(home, "projects.json"),
    stopState: join(home, "stop-hook.json"),
  };
}

export type Paths = ReturnType<typeof paths>;
