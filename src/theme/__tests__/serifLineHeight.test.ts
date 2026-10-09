/**
 * B15: serif headlines must never clip descenders on Android. Every serif
 * role keeps lineHeight >= SERIF_MIN_LINE_RATIO x fontSize, the ratio stays
 * above the lane floor (1.2) and above Cormorant's own line box (1.211 em).
 */
import { SERIF_MIN_LINE_RATIO, serifRoles, typography, wheel } from '../tokens';
import { Typography as LegacyTypography } from '../index';
import { Typography as ConstantsTypography } from '../../constants/theme';

const CORMORANT_LINE_BOX = (924 + 287) / 1000; // hhea ascent + |descent| per em

type Role = { fontFamily?: string; fontSize: number; lineHeight: number };

function serif(entries: Record<string, unknown>): Array<[string, Role]> {
  return Object.entries(entries).filter(
    (e): e is [string, Role] => typeof (e[1] as Role)?.fontFamily === 'string' && (e[1] as Role).fontFamily!.startsWith('CormorantGaramond'),
  );
}

describe('serif lineHeight floor', () => {
  it('the floor clears both the 1.2 rule and the font line box', () => {
    expect(SERIF_MIN_LINE_RATIO).toBeGreaterThanOrEqual(1.2);
    expect(SERIF_MIN_LINE_RATIO).toBeGreaterThan(CORMORANT_LINE_BOX);
  });

  it.each(serifRoles.map((r) => [r]))('tokens typography.%s', (role) => {
    const t = typography[role];
    expect(t.fontFamily.startsWith('CormorantGaramond')).toBe(true);
    expect(t.lineHeight).toBeGreaterThanOrEqual(Math.ceil(SERIF_MIN_LINE_RATIO * t.fontSize));
  });

  it('serifRoles lists every Cormorant role in the token scale', () => {
    expect(serif(typography).map(([k]) => k).sort()).toEqual([...serifRoles].sort());
  });

  it.each([
    ['theme Typography', LegacyTypography],
    ['constants Typography', ConstantsTypography],
    ['wheel', wheel],
  ] as const)('%s serif entries', (_name, scale) => {
    const entries = serif(scale as unknown as Record<string, unknown>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, t] of entries) {
      expect(t.lineHeight).toBeGreaterThanOrEqual(Math.ceil(SERIF_MIN_LINE_RATIO * t.fontSize));
    }
  });
});
