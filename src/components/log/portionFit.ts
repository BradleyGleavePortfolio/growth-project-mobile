/**
 * PORTION-WRAP-M (C2 C_portion): the portion sheet's food name and unit tabs read as drawn on every phone and
 * text size: the name on one line, the tabs in one row, no word cut, no ellipsis, every tab on screen.
 * Sizes are worked out from the fonts' own advance widths (em, 1/1000), so the phone, the web preview and the
 * tests agree; nothing here waits for a layout pass.
 */
import { layout } from '../../theme/tokens';

// Cormorant Garamond Regular (the title face), ASCII 32 to 126.
const CORMORANT_EM = [
  234, 247, 283, 526, 411, 574, 697, 140, 309, 309, 448, 398, 222, 323, 197, 341, 477, 332, 402, 389, 451, 409,
  465, 429, 489, 465, 197, 224, 407, 468, 407, 329, 719, 702, 558, 686, 691, 537, 509, 713, 759, 332, 322, 650,
  533, 835, 727, 766, 543, 766, 673, 491, 634, 698, 666, 931, 652, 609, 595, 274, 341, 274, 392, 398, 213, 419,
  510, 411, 512, 408, 305, 445, 499, 273, 257, 491, 258, 763, 517, 479, 511, 488, 364, 338, 338, 493, 434, 671,
  439, 435, 405, 289, 168, 283, 443,
];
// Inter Medium (the selected tab's face, the wider of the two) for each unit label.
const UNIT_EM: Record<string, number> = { g: 0.62, oz: 1.164, serving: 3.561, cup: 1.797, tbsp: 2.116, tsp: 1.498 };

// Rounding and kerning margin: a fitted line is sized 2% under the room it has.
const SAFE = 0.98;

/** Room for one line of the sheet: the window less its two gutters. */
export const sheetRoom = (windowWidth: number) => Math.max(0, windowWidth - 2 * layout.gutter);

const titleEm = (name: string) =>
  [...name].reduce((sum, ch) => sum + (CORMORANT_EM[(ch.codePointAt(0) ?? 0) - 32] ?? 600), 0) / 1000;

/**
 * The food name's size: its own size (30 pt times the text size) when it fits one line; else the largest size that
 * keeps it on one line, down to 24 pt (C_portion draws the name at about 24 pt). A name too long for one line even
 * then wraps at its own size, between words only (`text` keeps each hyphenated word whole).
 */
export function fitTitle(name: string, room: number, fontScale: number, letterSpacing = 0) {
  const own = 30 * (fontScale > 0 ? fontScale : 1);
  const chars = [...name].length;
  const fit = Math.floor(((room * SAFE - letterSpacing * chars) / Math.max(titleEm(name), 0.001)) * 4) / 4;
  const fontSize = fit >= own ? own : fit >= 24 ? fit : own;
  return { fontSize, lineHeight: Math.round(fontSize * (38 / 30)), oneLine: fontSize <= fit, text: name.replace(/-/g, '\u2011') };
}

/**
 * The unit tabs in one row. As drawn when they fit (64 pt tabs, 12 pt padding, 8 pt apart); else they sit edge to
 * edge as 44 pt targets with 8 pt between labels, the labels as large as the row allows (never under 12 pt); a
 * window narrower than any phone wraps the row so every tab still shows.
 */
export function fitUnitTabs(units: readonly string[], room: number, fontScale: number) {
  const own = 16 * (fontScale > 0 ? fontScale : 1);
  const em = (u: string) => UNIT_EM[u] ?? u.length * 0.65;
  const row = (size: number, pad: number, min: number, gap: number) =>
    units.reduce((sum, u) => sum + Math.max(min, em(u) * size + 2 * pad), 0) + gap * Math.max(0, units.length - 1);
  // Label widths are exact here (six known words), so the row keeps only 1 pt for rounding.
  const fits = (width: number) => width <= room - 1;
  if (fits(row(own, 12, 64, 8))) return { fontSize: own, padding: 12, minWidth: 64, gap: 8, wrap: false };
  let size = own;
  while (size > 12 && !fits(row(size, 4, layout.touchMin, 0))) size -= 0.25;
  const wrap = !fits(row(size, 4, layout.touchMin, 0));
  return { fontSize: wrap ? own : size, padding: 4, minWidth: layout.touchMin, gap: 0, wrap };
}
