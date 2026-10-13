import { describe, expect, test } from "bun:test";
import { daemonStatus } from "../src/cli/doctor/runtime.ts";
import type { Health } from "../src/daemon/control.ts";

const NOW = 10 * 60_000;

const health = (source: Partial<Health["source"]>): Health => ({
  ok: true,
  pid: 42,
  startedAt: "",
  version: "0.1.0",
  repos: ["acme/widgets"],
  source: { name: "gh-webhook-forward", state: "connected", detail: "", ...source },
});

describe("doctor daemon check", () => {
  test("a connected forwarder shows when it connected and last delivered", () => {
    const status = daemonStatus(
      health({ lastConnectedAt: NOW - 120_000, lastDeliveryAt: NOW - 5000 }),
      NOW,
    );
    expect(status).toEqual({
      level: "ok",
      name: "daemon",
      detail: "pid 42, gh-webhook-forward connected, connected 2m ago, last delivery 5s ago",
    });
  });

  test("no delivery yet is said plainly", () => {
    const status = daemonStatus(health({ lastConnectedAt: NOW, lastDeliveryAt: null }), NOW);
    expect(status.detail).toBe(
      "pid 42, gh-webhook-forward connected, connected 0s ago, no delivery yet",
    );
  });

  test("a disconnected forwarder warns with its error", () => {
    const status = daemonStatus(
      health({ state: "disconnected", detail: "acme/widgets: boom" }),
      NOW,
    );
    expect(status).toEqual({
      level: "warn",
      name: "daemon",
      detail: "pid 42, gh-webhook-forward disconnected (acme/widgets: boom)",
    });
  });
});
