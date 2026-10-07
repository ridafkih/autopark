import type { Delivery, SourceContext, SourceDependencies } from "../../src/sources/types.ts";
import { FakeClock } from "./clock.ts";

export function recordingContext(repos: string[] = ["acme/widgets"]) {
  const deliveries: Delivery[] = [];
  const reconnects: string[] = [];
  const logs: string[] = [];
  const context: SourceContext = {
    repos,
    deliver: async (delivery) => deliveries.push(delivery),
    reconnected: (reason) => reconnects.push(reason),
    log: (message) => logs.push(message),
  };
  return { context, deliveries, reconnects, logs };
}

export const unspawnableDependencies = (baseDir: string): SourceDependencies => ({
  clock: new FakeClock(),
  port: 0,
  secret: "",
  spawn: () => {
    throw new Error("no");
  },
  baseDir,
});
