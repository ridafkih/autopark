import type { LoggedTransition, TransitionKind } from "../../src/core/types.ts";

export const TRANSITION_HEAD = "1111111111111111111111111111111111111111";

export const BASE_TRANSITION: LoggedTransition = {
  id: 42,
  ts: "2026-10-06T00:00:00.000Z",
  kind: "ready",
  repo: "acme/widgets",
  number: 7,
  head: TRANSITION_HEAD,
  reason: "all readiness rules pass",
  data: {},
  title: "Tidy the widget loader",
  url: "https://github.com/acme/widgets/pull/7",
};

export const transitionOf = (
  kind: TransitionKind,
  data: Record<string, unknown> = {},
  reason = "r",
): LoggedTransition => ({ ...BASE_TRANSITION, kind, data, reason });
