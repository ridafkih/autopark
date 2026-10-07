import { NUDGE_KINDS } from "../core/types.ts";
import { arraySchema, nullableSchema, objectSchema } from "./dsl/collections.ts";
import { durationSchema } from "./dsl/duration.ts";
import { booleanSchema, enumSchema } from "./dsl/scalars.ts";

const MINUTE_MS = 60_000;

export const nudgeSection = objectSchema({
  after: durationSchema({
    default: "10m",
    description: "First nudge once a PR has been blocked by the same reasons for this long",
  }),
  every: durationSchema({
    default: "10m",
    minMs: MINUTE_MS,
    description: "Repeat the nudge this often while the PR stays blocked",
  }),
  escalateAfter: nullableSchema(durationSchema(), {
    default: null,
    description: "Mark nudges escalated (and louder) once a PR has been blocked this long",
  }),
  kinds: arraySchema(enumSchema(NUDGE_KINDS), {
    default: NUDGE_KINDS.filter((kind) => kind !== "draft"),
    description:
      "Blocking reasons that nudge; a draft stays silent unless draft is listed. awaiting_human covers PRs that wait only on approval",
  }),
  quietWhenHeadMoving: booleanSchema({
    default: true,
    description: "No nudge while the head moved within the last `after`",
  }),
  nudgeReadyUnmerged: booleanSchema({
    default: false,
    description: "Also nudge PRs that are ready but not merged",
  }),
});
