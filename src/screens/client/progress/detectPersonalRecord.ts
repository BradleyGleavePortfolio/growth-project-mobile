/**
 * detectPersonalRecord — ED.4 auto-PR flag detection (client app).
 *
 * The repo has NO pre-existing personal-record helper (verified by grep — the
 * only "PR" hits are pull-request references). Per the builder brief's
 * fallback rule ("if absent, derive from Math.max over historical values"),
 * this derives the record from the series itself: the PR is the data point with
 * the maximum value. To avoid flagging a flat or still-improving baseline as a
 * "record", a point only counts as a PR when it STRICTLY exceeds every value
 * before it (a genuine new high-water mark), AND there is more than one point.
 *
 * This is intentionally pure + dependency-free so it can be unit-tested in
 * isolation and reused by the chart and the Roman commentary on the same data.
 */

export interface ProgressPoint {
  /** X position — epoch ms or a session index; only ordering matters here. */
  readonly x: number;
  /** The tracked value (e.g. top-set weight in pounds). */
  readonly y: number;
}

export interface PersonalRecord {
  /** Index into the input series of the PR point. */
  readonly index: number;
  /** The PR point itself. */
  readonly point: ProgressPoint;
}

/**
 * Find the personal-record point in an ordered series. Returns null when there
 * is no genuine new high (e.g. fewer than two points, or the max sits at the
 * very first sample so nothing was actually beaten).
 *
 * "Genuine new high" = the maximum value in the series, occurring at a point
 * that strictly exceeds all PRIOR points. When the max is tied across multiple
 * points, the FIRST occurrence (the moment the record was set) is returned.
 */
export function detectPersonalRecord(
  series: readonly ProgressPoint[],
): PersonalRecord | null {
  if (series.length < 2) return null;

  let bestSoFar = series[0].y;
  let prIndex = -1;
  let prValue = -Infinity;

  for (let i = 1; i < series.length; i += 1) {
    const y = series[i].y;
    // A strict new high over everything before it is a record-setting moment.
    if (y > bestSoFar && y > prValue) {
      prIndex = i;
      prValue = y;
    }
    if (y > bestSoFar) bestSoFar = y;
  }

  if (prIndex < 0) return null;
  return { index: prIndex, point: series[prIndex] };
}
