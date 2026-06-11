/**
 * WCAG 2.1 relative-luminance contrast helper (test + runtime utility).
 *
 * Lets a component (and its test) assert a foreground/background pair clears
 * the AA threshold WITHOUT hard-coding pre-computed ratios that silently rot
 * when a token changes. `contrastRatio` returns the 1–21 ratio; `meetsAA`
 * applies the 4.5:1 normal-text / 3:1 large-text gate (product copy in the ack
 * badge is 12px 600-weight → treated as normal text → 4.5:1).
 *
 * Accepts `#RGB` and `#RRGGBB`. Unknown input throws (a malformed token is a
 * bug we want loud, not a silent pass).
 */

/** AA contrast minimum for normal-weight body text. */
export const AA_NORMAL = 4.5;
/** AA contrast minimum for large (≥18.66px bold / ≥24px) text. */
export const AA_LARGE = 3;

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (m == null) throw new Error(`contrast: malformed hex "${hex}"`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const r = channelLuminance(parseInt(h.slice(0, 2), 16));
  const g = channelLuminance(parseInt(h.slice(2, 4), 16));
  const b = channelLuminance(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio (1–21) between two hex colors. */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** True when the pair clears the AA threshold (default normal-text 4.5:1). */
export function meetsAA(fg: string, bg: string, min: number = AA_NORMAL): boolean {
  return contrastRatio(fg, bg) >= min;
}
