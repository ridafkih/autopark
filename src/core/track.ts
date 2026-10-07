import type { Config } from "../config/schema.ts";

type TrackFilter = Config["track"];

export interface Candidate {
  repo: string;
  number: number;
  author: string | null;
  headRef: string;
  baseRef: string;
  labels: string[];
  open: boolean;
}

export const hasTrackFilter = (filter: TrackFilter) =>
  filter.authors.length > 0 || filter.branchPrefixes.length > 0 || filter.labels.length > 0;

function matchesAuthor(candidate: Candidate, filter: TrackFilter, viewer: string | null) {
  if (filter.authors.length === 0) return true;
  const authors = filter.authors.map((author) =>
    (author === "@me" ? (viewer ?? "") : author).toLowerCase(),
  );
  return authors.includes((candidate.author ?? "").toLowerCase());
}

const matchesBranch = (candidate: Candidate, filter: TrackFilter) =>
  filter.branchPrefixes.length === 0 ||
  filter.branchPrefixes.some((prefix) => candidate.headRef.startsWith(prefix));

const matchesLabel = (candidate: Candidate, filter: TrackFilter) =>
  filter.labels.length === 0 || filter.labels.some((label) => candidate.labels.includes(label));

export function matchesTrackFilter(
  candidate: Candidate,
  filter: TrackFilter,
  viewer: string | null,
) {
  return (
    candidate.open &&
    hasTrackFilter(filter) &&
    matchesAuthor(candidate, filter, viewer) &&
    matchesBranch(candidate, filter) &&
    matchesLabel(candidate, filter)
  );
}
