import { describe, expect, test } from "bun:test";
import { handleRpc, negotiate, SUPPORTED_PROTOCOLS } from "../src/channel/mcp.ts";

const [NEWEST_PROTOCOL = ""] = SUPPORTED_PROTOCOLS;
const INFO = { name: "pr-autopilot", version: "0.1.0", instructions: "react with the playbook" };

describe("mcp protocol negotiation", () => {
  test.each([
    ["the revision that disables channels is never echoed", "2026-07-28", NEWEST_PROTOCOL],
    ["a supported revision is echoed", "2025-03-26", "2025-03-26"],
    ["the oldest supported revision", "2024-11-05", "2024-11-05"],
    ["garbage falls back to the newest supported", 7, NEWEST_PROTOCOL],
  ] as const)("%s", (label, requested, expected) => {
    expect(negotiate(requested)).toBe(expected);
  });

  test("SUPPORTED never includes 2026-07-28", () => {
    expect(SUPPORTED_PROTOCOLS).not.toContain("2026-07-28");
  });
});

describe("mcp message handling", () => {
  test("initialize declares the claude/channel capability and instructions", () => {
    const outcome = handleRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "claude-code" },
        },
      },
      INFO,
    );
    expect(outcome.response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { experimental: { "claude/channel": {} } },
        serverInfo: { name: "pr-autopilot", version: "0.1.0" },
        instructions: "react with the playbook",
      },
    });
  });

  test.each([
    [
      "initialized notification flips the ready flag",
      { jsonrpc: "2.0", method: "notifications/initialized" },
      undefined,
      true,
    ],
    [
      "ping answers with an empty result",
      { jsonrpc: "2.0", id: 2, method: "ping" },
      { jsonrpc: "2.0", id: 2, result: {} },
      false,
    ],
    [
      "unknown request is method-not-found",
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, error: { code: -32_601, message: "method not found: tools/list" } },
      false,
    ],
    [
      "unknown notification is ignored",
      { jsonrpc: "2.0", method: "notifications/cancelled" },
      undefined,
      false,
    ],
  ] as const)("%s", (label, message, response, isInitialized) => {
    const outcome = handleRpc(message, INFO);
    expect(outcome.response).toEqual(response);
    expect(outcome.initialized === true).toBe(isInitialized);
  });
});
