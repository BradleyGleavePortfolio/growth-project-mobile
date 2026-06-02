/**
 * smoothPath — pure SVG path builders for the Revolut glow chart line + area.
 *
 * The chart (RevolutGlowChart) is the VISCERAL PEAK of the H&F surface (Don
 * Norman first-50–200ms layer / peak-end rule, Mobile Design Intel doc). A raw
 * `<Polyline>` reads as "tutorial code"; the premium Revolut feel comes from a
 * smooth bezier line over a soft gradient area fill. These helpers are kept
 * PURE (no React, no SVG element creation) so the interpolation can be unit-
 * tested in isolation and called on every geometry change without allocation
 * surprises.
 *
 * Interpolation: MONOTONE CUBIC (Fritsch–Carlson). Unlike a naive Catmull-Rom
 * spline, a monotone cubic never overshoots between data points — critical for
 * sparkline-style health data (heart rate, steps, sleep score) where an
 * overshoot would invent a value the user never recorded (an #17 "fake
 * confidence" failure rendered as a curve). Between two samples the curve stays
 * within their value range.
 *
 * Coordinates are caller-space (the chart passes a normalized 0..100 box); the
 * helpers are unit-agnostic.
 */

export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

/** Format a number for an SVG path command — trim noise, keep it compact. */
function f(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // 3 dp is sub-pixel at any sane chart size and keeps the `d` string small.
  return (Math.round(n * 1000) / 1000).toString();
}

/**
 * Compute monotone-cubic tangents (slopes) at each point, per Fritsch–Carlson.
 * Returns one slope `m[i]` per point. Guarantees monotonicity (no overshoot)
 * by clamping tangents where a secant is flat or changes sign.
 */
function monotoneTangents(points: readonly PathPoint[]): number[] {
  const n = points.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;

  // Secant slopes between consecutive points.
  const d = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    d[i] = dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx;
  }

  // Endpoint tangents = adjacent secant; interior = average of neighbours.
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      // Sign change or a flat → local extremum: zero the tangent so the curve
      // turns without overshooting past the data value.
      m[i] = 0;
    } else {
      m[i] = (d[i - 1] + d[i]) / 2;
    }
  }

  // Fritsch–Carlson monotonicity clamp.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = (3 / Math.sqrt(s));
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  return m;
}

/**
 * Build a smooth SVG line path (`M … C …`) through the points using monotone
 * cubic interpolation. Returns `''` for an empty input and a lone `M` for a
 * single point. The returned string ALWAYS starts with `M` and, for ≥2 points,
 * contains at least one `C` cubic-bezier command.
 */
export function smoothLinePath(points: readonly PathPoint[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${f(points[0].x)} ${f(points[0].y)}`;

  const m = monotoneTangents(points);
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = p1.x - p0.x;
    // Cubic control points placed at thirds of the interval along each
    // point's tangent — the standard Hermite→Bezier conversion.
    const c1x = p0.x + dx / 3;
    const c1y = p0.y + (m[i] * dx) / 3;
    const c2x = p1.x - dx / 3;
    const c2y = p1.y - (m[i + 1] * dx) / 3;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p1.x)} ${f(p1.y)}`;
  }

  return d;
}

/**
 * Build the closed area path for the gradient fill: the smooth line, then down
 * to the baseline at the last x, across to the first x, and closed. `baselineY`
 * is the y of the chart's bottom in caller space. Returns `''` when there is
 * nothing to fill (fewer than 2 points).
 */
export function smoothAreaPath(
  points: readonly PathPoint[],
  baselineY: number,
): string {
  const n = points.length;
  if (n < 2) return '';
  const line = smoothLinePath(points);
  const lastX = points[n - 1].x;
  const firstX = points[0].x;
  return `${line} L ${f(lastX)} ${f(baselineY)} L ${f(firstX)} ${f(baselineY)} Z`;
}
