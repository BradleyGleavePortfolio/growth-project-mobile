// Style C v2 (MOCK-C1V2 index-v2 sections 4-5): every new text and chart pair
// clears WCAG 2.x in light and dark. Text needs 4.5:1 (1.4.3); chart marks and
// rings need 3:1 (1.4.11). The table matches src/theme/README.md.
import { colors, lightTokens, darkTokens, type SemanticTokens } from '../tokens';

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const TEXT = 4.5;
const MARK = 3;

const pairs = (t: SemanticTokens): Array<[string, string, string, number]> => [
  ['masthead, secondary text', t.textOnMastheadMuted, t.surface.masthead, TEXT],
  ['masthead, primary text', t.textOnAccent, t.surface.masthead, TEXT],
  ['masthead, leaf text, done arcs and today ring', t.data.leaf, t.surface.masthead, TEXT],
  ['masthead, missed ring and number', t.data.missedOnDark, t.surface.masthead, TEXT],
  ['masthead, gold label and star', t.data.peak, t.surface.masthead, TEXT],
  ['masthead, planned arcs and rings', t.data.plannedOnDark, t.surface.masthead, MARK],
  ['masthead, error card edge', colors.warningBg, t.surface.masthead, MARK],
  ['forest band, primary text', t.textOnAccent, t.surface.forestBand, TEXT],
  ['forest band, secondary text', t.textOnMastheadMuted, t.surface.forestBand, TEXT],
  ['forest band, rest ring and done chip check', t.data.leaf, t.surface.forestBand, MARK],
  ['sage, primary text', t.textPrimary, t.surface.sage, TEXT],
  ['sage, secondary text', t.textMuted, t.surface.sage, TEXT],
  ['sage, accent text', t.accentText, t.surface.sage, TEXT],
  ['sage, done disc and up icon', t.data.forest, t.surface.sage, MARK],
  ['sage, sparkline', t.data.moss, t.surface.sage, MARK],
  ['sage, planned border', t.data.planned, t.surface.sage, MARK],
  ['sage, gold point outline', t.data.peakInk, t.surface.sage, MARK],
  ['check on leaf, effort 1-2', colors.ink, t.data.leaf, TEXT],
  ['effort 3-4', colors.ink, t.data.fern, TEXT],
  ['effort 5-6', t.textOnAccent, t.data.moss, TEXT],
  ['effort 7-8, check on a done disc', t.textOnAccent, t.data.forest, TEXT],
  ['effort 9-10', t.textOnAccent, t.data.deep, TEXT],
  ['progress fill on track', t.data.forest, t.data.trackLight, MARK],
  ...([['bgPrimary', t.bgPrimary], ['bgSurface', t.bgSurface]] as const).flatMap(([n, bg]): Array<[string, string, string, number]> => [
    [`${n}, missed number`, t.data.missed, bg, TEXT],
    [`${n}, done arcs, discs and selected ring`, t.data.forest, bg, MARK],
    [`${n}, moss lines, dots and chip edges`, t.data.moss, bg, MARK],
    [`${n}, planned arcs and rings`, t.data.planned, bg, MARK],
    [`${n}, star outline`, t.data.peakInk, bg, MARK],
  ]),
];

describe.each<[string, SemanticTokens]>([['light', lightTokens], ['dark', darkTokens]])('Style C v2 contrast, %s', (_scheme, t) => {
  it.each(pairs(t))('%s', (_pair, fg, bg, min) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

it('light: charcoal cue text on sage (dark uses textMuted)', () => {
  expect(ratio(colors.charcoal, lightTokens.surface.sage)).toBeGreaterThanOrEqual(TEXT);
});

it('keeps the index-v2 section 4 light values', () => {
  expect(lightTokens.surface).toEqual({ masthead: '#1C3023', forestBand: '#2C4A36', sage: '#E0EBE4', sageLine: '#C9D8CD' });
  expect(lightTokens.textOnMastheadMuted).toBe('#B8CCBF');
  expect(lightTokens.data).toEqual({
    leaf: '#A3C46A', fern: '#7FA653', moss: '#4E7A3F', forest: '#2C4A36', deep: '#1C3023', peak: '#D4B96B',
    peakInk: '#6B4F1A', planned: '#857F75', plannedOnDark: '#6E9479', missed: '#6B675F', missedOnDark: '#B1A89F',
    trackLight: '#E6DFD3',
  });
});
