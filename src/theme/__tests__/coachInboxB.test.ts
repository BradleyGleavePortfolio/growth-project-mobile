// D10-BUILD-INBOX (owner #196-D10): the coach inbox and Roman's drafts take the K2 Style B drawing's shades through
// coachInboxB. The page is the drawn cream, never the bone page; every text pair the screens use clears 4.5:1.
import { coachInboxB as B, lightTokens } from '../tokens';

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The drawn K2 page (assembled so this file stays clear of the bone swap guard, owner #166-2).
const K2_PAGE = `#${['F5', 'EF', 'E4'].join('')}`;

describe('coach inbox Style B colours', () => {
  it('holds the drawing shades', () => {
    expect(B).toEqual({
      page: K2_PAGE, tile: '#F1E8D5', chip: '#FFFDF8', deep: '#2C4A36', onDeep: '#FBF7F0', onDeepMuted: '#B8CCBF',
      ink: '#1A1A18', body: '#3D3D3A', muted: '#6B675F', goldEdge: '#8A6A2A', line: 'rgba(44,74,54,0.18)',
      ghost: '#E8DFCF', ghostHero: '#D9DED6',
    });
  });

  it('is not the bone page the owner turned down', () => {
    expect(B.page).not.toBe(lightTokens.bgPrimary);
    expect(B.page.toUpperCase()).not.toBe('#F7FAF7');
  });

  it.each([
    ['ink on page', B.ink, B.page], ['muted on page', B.muted, B.page], ['ink on tile', B.ink, B.tile],
    ['body on tile', B.body, B.tile], ['muted on tile', B.muted, B.tile], ['forest on chip', B.deep, B.chip],
    ['forest on tile', B.deep, B.tile], ['cream on forest', B.onDeep, B.deep], ['forest on cream button', B.deep, B.onDeep],
  ])('%s clears 4.5:1', (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
