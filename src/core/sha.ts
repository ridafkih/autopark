const MIN_COMPARABLE_LENGTH = 7;

const isComparable = (sha: string | null): sha is string =>
  sha !== null && sha.length >= MIN_COMPARABLE_LENGTH;

export function shaMatches(left: string | null, right: string | null) {
  if (!isComparable(left) || !isComparable(right)) return false;
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  return lowerLeft.startsWith(lowerRight) || lowerRight.startsWith(lowerLeft);
}
