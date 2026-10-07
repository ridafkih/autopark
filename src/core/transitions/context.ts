import { shortSha } from "../format.ts";
import type { Evaluation, Transition, TransitionKind } from "../types.ts";

export interface DiffOptions {
  mergeabilityExhausted?: boolean;
}

export type Emit = (
  kind: TransitionKind,
  reason: string,
  data?: Record<string, unknown>,
) => Transition;

export interface DiffContext {
  previous: Evaluation | null;
  sameHeadPrevious: Evaluation | null;
  next: Evaluation;
  options: DiffOptions;
  emit: Emit;
}

export type Detector = (context: DiffContext) => Transition[];

export const describeSha = (sha: string | null) => (sha ? shortSha(sha) : "unknown");

export function diffContext(
  previous: Evaluation | null,
  next: Evaluation,
  options: DiffOptions,
): DiffContext {
  const emit: Emit = (kind, reason, data = {}) => ({
    kind,
    repo: next.repo,
    number: next.number,
    head: next.headSha || null,
    reason,
    data,
  });
  const sameHeadPrevious = previous?.headSha === next.headSha ? previous : null;
  return { previous, sameHeadPrevious, next, options, emit };
}
