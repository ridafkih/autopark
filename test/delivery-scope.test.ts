import { describe, expect, test } from "bun:test";
import { inScope, monitorShouldEmit } from "../src/channel/scope.ts";
import { sessionIdFrom } from "../src/core/session.ts";
import { BASE_TRANSITION } from "./fixtures/transition.ts";

describe("delivery scope", () => {
  test.each([
    { label: "no config and no session delivers nothing", repos: [], expected: false },
    { label: "repo in config", repos: ["Acme/Widgets"], expected: true },
    { label: "repo outside config", repos: ["acme/other"], expected: false },
    {
      label: "no config, PR bound to this session",
      repos: [],
      session: ["s1", "s1"],
      expected: true,
    },
    {
      label: "no config, PR bound to another session",
      repos: [],
      session: ["s1", "s2"],
      expected: false,
    },
    {
      label: "no config, PR bound to no session",
      repos: [],
      session: ["s1", null],
      expected: false,
    },
    {
      label: "repo outside config, PR bound to this session",
      repos: ["acme/other"],
      session: ["s1", "s1"],
      expected: true,
    },
    {
      label: "repo in config, PR bound to another session",
      repos: ["acme/widgets"],
      session: ["s1", "s2"],
      expected: true,
    },
  ])("$label", ({ repos, session = [null, null], expected }) => {
    const [sessionId = null, boundTo = null] = session;
    const scope = { repos: [...repos], sessionId, sessionOf: () => boundTo };
    expect(inScope(BASE_TRANSITION, scope)).toBe(expected);
  });

  test("the binding is looked up only when the session could match", () => {
    const lookups: string[] = [];
    const sessionOf = (transition: { repo: string }) => {
      lookups.push(transition.repo);
      return null;
    };
    inScope(BASE_TRANSITION, { repos: ["acme/widgets"], sessionId: "s1", sessionOf });
    inScope(BASE_TRANSITION, { repos: [], sessionId: null, sessionOf });
    expect(lookups).toEqual([]);
  });

  test.each([
    ["Claude Code's session id", { CLAUDE_CODE_SESSION_ID: "a" }, "a"],
    ["the legacy name as a fallback", { CLAUDE_SESSION_ID: "b" }, "b"],
    ["Claude Code's name wins", { CLAUDE_CODE_SESSION_ID: "a", CLAUDE_SESSION_ID: "b" }, "a"],
    ["empty values are no session", { CLAUDE_CODE_SESSION_ID: "", CLAUDE_SESSION_ID: "" }, null],
    ["nothing set", {}, null],
  ] as const)("sessionIdFrom: %s", (label, env, expected) => {
    expect(sessionIdFrom(env)).toBe(expected);
  });

  test.each([
    ["off never emits", ["off", true, false], false],
    ["always emits even with a live channel", ["always", true, true], true],
    ["auto emits when no live channel delivers to the session", ["auto", true, false], true],
    ["auto stands down while a live channel delivers to the session", ["auto", true, true], false],
    ["auto emits when the channel is disabled in config", ["auto", false, true], true],
  ] as const)("monitor: %s", (label, [mode, isChannelEnabled, isChannelLive], expected) => {
    expect(monitorShouldEmit(mode, isChannelEnabled, isChannelLive)).toBe(expected);
  });
});
