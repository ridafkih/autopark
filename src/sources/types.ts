import type { Clock } from "../daemon/clock.ts";

export interface Delivery {
  id: string;
  event: string;
  payload: unknown;
}

export type SourceState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped"
  | "error";

export interface SourceStatus {
  name: string;
  state: SourceState;
  detail: string;
  perRepo?: Record<string, SourceState>;
}

export interface SourceContext {
  repos: string[];
  deliver(d: Delivery): Promise<unknown>;
  reconnected(reason: string): void;
  log(msg: string): void;
}

export interface EventSource {
  readonly name: string;
  start(ctx: SourceContext): Promise<void>;
  stop(): Promise<void>;
  status(): SourceStatus;
}

export interface ChildHandle {
  lines: AsyncIterable<string>;
  exited: Promise<number>;
  kill(): void;
}

export type Spawner = (cmd: string[], env: Record<string, string>) => ChildHandle;

export interface SourceDependencies {
  clock: Clock;
  port: number;
  secret: string;
  spawn: Spawner;
  baseDir: string;
}

export type SourceFactory = (
  options: Record<string, unknown>,
  deps: SourceDependencies,
) => EventSource;
