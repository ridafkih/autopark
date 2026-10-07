import type { Config } from "../config/schema.ts";

export interface Candidate {
  repo: string;
  number: number;
  author: string | null;
  headRef: string;
  baseRef: string;
  labels: string[];
  open: boolean;
}

export function matchesTrackFilter(c: Candidate, f: Config["track"], viewer: string | null) {
  if (!c.open) return false;
  if (!f.authors.length && !f.branchPrefixes.length && !f.labels.length) return false;
  const authors = f.authors.map((a) => (a === "@me" ? (viewer ?? "") : a).toLowerCase());
  if (authors.length && !authors.includes((c.author ?? "").toLowerCase())) return false;
  if (f.branchPrefixes.length && !f.branchPrefixes.some((p) => c.headRef.startsWith(p)))
    return false;
  if (f.labels.length && !f.labels.some((l) => c.labels.includes(l))) return false;
  return true;
}
