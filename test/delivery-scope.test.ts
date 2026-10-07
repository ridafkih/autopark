import { describe, expect, test } from "bun:test";
import { channelLoaded, inScope, monitorShouldEmit } from "../src/channel/scope.ts";
import { BASE_TRANSITION } from "./fixtures/transition.ts";

describe("delivery scope", () => {
  test.each([
    ["no config delivers everything", null, "acme/widgets", true],
    ["repo in config", ["Acme/Widgets"], "acme/widgets", true],
    ["repo outside config", ["acme/other"], "acme/widgets", false],
  ] as const)("%s", (label, repos, repo, expected) => {
    const scope = { repos: repos ? [...repos] : null };
    expect(inScope({ ...BASE_TRANSITION, repo }, scope)).toBe(expected);
  });

  test.each([
    [
      "dev channel flag naming the plugin",
      ["claude --dangerously-load-development-channels plugin:autopark@autopark"],
      true,
    ],
    [
      "approved channels flag naming the plugin",
      ["/usr/local/bin/claude --channels plugin:autopark@team"],
      true,
    ],
    [
      "dev channel flag for another plugin",
      ["claude --dangerously-load-development-channels plugin:fakechat@x"],
      false,
    ],
    ["plain session", ["claude", "zsh"], false],
    [
      "flag on an ancestor further up",
      [
        "sh -c autopark watch",
        "node claude --dangerously-load-development-channels server:autopark",
      ],
      true,
    ],
  ] as const)("channelLoaded: %s", (label, commandLines, expected) => {
    expect(channelLoaded([...commandLines])).toBe(expected);
  });

  test.each([
    ["off never emits", ["off", true, false], false],
    ["always emits even with the channel loaded", ["always", true, true], true],
    ["auto emits when the channel is not loaded", ["auto", true, false], true],
    ["auto stands down when the channel is loaded", ["auto", true, true], false],
    ["auto emits when the channel is disabled in config", ["auto", false, true], true],
  ] as const)("monitor: %s", (label, [mode, isChannelEnabled, isLoaded], expected) => {
    expect(monitorShouldEmit(mode, isChannelEnabled, isLoaded)).toBe(expected);
  });
});
