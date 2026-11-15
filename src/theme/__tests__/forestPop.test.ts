// Forest Pop (C6CHAT-S-V2 section 6): the community roles reuse TGP tokens
// only, and every text pair the plan uses clears WCAG 2.x 4.5:1. The table
// matches src/theme/README.md.
import { brand, colors, forestPop, gold, lightTokens, neutral, semantic } from '../tokens';

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const p = forestPop;

describe('Forest Pop community colours', () => {
  it('holds exactly the plan hex values', () => {
    expect(p).toEqual({
      deep: '#1C3023', forest: '#2C4A36', leaf: '#A3C46A', moss: '#4E7A3F',
      gold: '#D4B96B', goldInk: '#6B4F1A', sage: '#E0EBE4', sageLine: '#C9D8CD',
      surface: '#FFFDF8', ink: '#1A1A18', n700: '#5A5A56', brand400: '#4D7059',
      onDeep: '#FBF7F0', onDeepMuted: '#B8CCBF', error: '#B91C1C',
    });
  });

  it('adds no new colour: every role is already a TGP token', () => {
    const flat = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? flat(v) : []));
    const existing = new Set(flat({ colors, neutral, brand, semantic, gold, lightTokens }));
    expect(Object.values(p).filter((hex) => !existing.has(hex))).toEqual([]);
  });

  it.each<[string, string, string, number]>([
    ['ink on surface', p.ink, p.surface, 17.15],
    ['n700 on surface', p.n700, p.surface, 6.81],
    ['brand400 on surface', p.brand400, p.surface, 5.47],
    ['forest on surface', p.forest, p.surface, 9.65],
    ['moss on surface', p.moss, p.surface, 4.94],
    ['goldInk on surface', p.goldInk, p.surface, 7.49],
    ['ink on sage', p.ink, p.sage, 14.25],
    ['n700 on sage', p.n700, p.sage, 5.66],
    ['forest on sage', p.forest, p.sage, 8.03],
    ['onDeep on deep', p.onDeep, p.deep, 13.14],
    ['onDeepMuted on deep', p.onDeepMuted, p.deep, 8.3],
    ['leaf on deep', p.leaf, p.deep, 7.12],
    ['gold on deep', p.gold, p.deep, 7.32],
    ['onDeep on forest', p.onDeep, p.forest, 9.19],
    ['onDeepMuted on forest', p.onDeepMuted, p.forest, 5.81],
    ['leaf on forest', p.leaf, p.forest, 4.98],
    ['ink on leaf', p.ink, p.leaf, 8.85],
    ['ink on gold', p.ink, p.gold, 9.09],
    ['error on surface', p.error, p.surface, 6.36],
  ])('%s clears 4.5:1 at the plan ratio', (_use, fg, bg, plan) => {
    const r = ratio(fg, bg);
    expect(r).toBeGreaterThanOrEqual(4.5);
    expect(r).toBeCloseTo(plan, 1);
  });

  it('leaf and gold fail as text on the light page, so they never sit there as text', () => {
    expect(ratio(p.leaf, p.surface)).toBeLessThan(4.5);
    expect(ratio(p.gold, p.surface)).toBeLessThan(4.5);
  });
});
