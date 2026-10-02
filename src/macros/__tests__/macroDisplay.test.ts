/**
 * Lighter start for never-trackers (clinic contract v1 addition 8): pure
 * rules for parsing the server field, the effective mode, the one-time
 * carbohydrate and fat introduction, and what each surface shows.
 */
import {
  effectiveMacroDisplayMode,
  emptyMacroDisplayRecord,
  foodMacroLine,
  homeCells,
  mergeMacroDisplay,
  parseMacroDisplay,
  parseMacroDisplayRecord,
  parseUntil,
  shouldShowFullMacrosIntro,
  targetCells,
  type MacroDisplayRecord,
} from '../macroDisplay';

const at = (iso: string) => new Date(iso);
const rec = (over: Partial<MacroDisplayRecord>): MacroDisplayRecord => ({
  ...emptyMacroDisplayRecord(),
  ...over,
});

describe('parseMacroDisplay', () => {
  it('reads the field from a /me/macros/current target', () => {
    expect(
      parseMacroDisplay({ calories_kcal: 1789, macro_display_mode: 'simple', simple_until: '2026-10-08' }),
    ).toEqual({ mode: 'simple', simpleUntil: '2026-10-08' });
  });

  it('reads the field from an onboarding complete payload or envelope', () => {
    expect(
      parseMacroDisplay({ complete: { macros: {}, macro_display_mode: 'simple', simple_until: '2026-10-08T07:00:00Z' } }),
    ).toEqual({ mode: 'simple', simpleUntil: '2026-10-08T07:00:00Z' });
    expect(parseMacroDisplay({ data: { macro_display_mode: 'full', simple_until: null } })).toEqual({
      mode: 'full',
      simpleUntil: null,
    });
  });

  it('returns null when the field is absent or unknown (caller keeps full)', () => {
    expect(parseMacroDisplay(null)).toBeNull();
    expect(parseMacroDisplay({ calories_kcal: 1789, protein_g: 150 })).toBeNull();
    expect(parseMacroDisplay({ macro_display_mode: 'minimal' })).toBeNull();
    expect(parseMacroDisplay('simple')).toBeNull();
  });

  it('drops an unparseable simple_until rather than inventing one', () => {
    expect(parseMacroDisplay({ macro_display_mode: 'simple', simple_until: 'next week' })).toEqual({
      mode: 'simple',
      simpleUntil: null,
    });
  });
});

describe('parseUntil', () => {
  it('treats a bare date as the start of that local day', () => {
    const d = parseUntil('2026-10-08')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 8, 0]);
  });
  it('accepts a full ISO date-time and rejects junk', () => {
    expect(parseUntil('2026-10-08T07:00:00Z')!.toISOString()).toBe('2026-10-08T07:00:00.000Z');
    expect(parseUntil('soon')).toBeNull();
    expect(parseUntil(null)).toBeNull();
  });
});

describe('effectiveMacroDisplayMode', () => {
  it('defaults to full with no record or no field (no behaviour change)', () => {
    expect(effectiveMacroDisplayMode(null)).toBe('full');
    expect(effectiveMacroDisplayMode(emptyMacroDisplayRecord())).toBe('full');
  });

  it('is simple before simple_until and full from that moment on', () => {
    const r = rec({ mode: 'simple', simpleUntil: '2026-10-08T07:00:00Z' });
    expect(effectiveMacroDisplayMode(r, at('2026-10-01T12:00:00Z'))).toBe('simple');
    expect(effectiveMacroDisplayMode(r, at('2026-10-08T06:59:59Z'))).toBe('simple');
    expect(effectiveMacroDisplayMode(r, at('2026-10-08T07:00:00Z'))).toBe('full');
  });

  it('stays simple while the server says simple with no end date', () => {
    expect(effectiveMacroDisplayMode(rec({ mode: 'simple' }), at('2030-01-01T00:00:00Z'))).toBe('simple');
  });
});

describe('mergeMacroDisplay', () => {
  it('ignores a body without the field', () => {
    const r = rec({ mode: 'simple', simpleUntil: '2026-10-08', seenSimple: true });
    expect(mergeMacroDisplay(r, null)).toBe(r);
  });

  it('remembers that the client started simple, and keeps the end date when the server flips to full', () => {
    let r = mergeMacroDisplay(emptyMacroDisplayRecord(), { mode: 'simple', simpleUntil: '2026-10-08' });
    expect(r).toMatchObject({ mode: 'simple', simpleUntil: '2026-10-08', seenSimple: true });
    r = mergeMacroDisplay(r, { mode: 'full', simpleUntil: null });
    expect(r).toMatchObject({ mode: 'full', simpleUntil: '2026-10-08', seenSimple: true });
  });

  it('returns the same object when nothing changed', () => {
    const r = mergeMacroDisplay(emptyMacroDisplayRecord(), { mode: 'simple', simpleUntil: '2026-10-08' });
    expect(mergeMacroDisplay(r, { mode: 'simple', simpleUntil: '2026-10-08' })).toBe(r);
  });
});

describe('shouldShowFullMacrosIntro', () => {
  const started = rec({ mode: 'simple', simpleUntil: '2026-10-08T07:00:00Z', seenSimple: true });

  it('is hidden during the simple week', () => {
    expect(shouldShowFullMacrosIntro(started, at('2026-10-05T12:00:00Z'))).toBe(false);
  });
  it('shows on the day simple_until passes', () => {
    expect(shouldShowFullMacrosIntro(started, at('2026-10-08T07:00:00Z'))).toBe(true);
  });
  it('shows when the server reports full after a simple start', () => {
    expect(shouldShowFullMacrosIntro({ ...started, mode: 'full' }, at('2026-10-05T12:00:00Z'))).toBe(true);
  });
  it('never shows again once dismissed', () => {
    expect(
      shouldShowFullMacrosIntro({ ...started, introDismissedAt: '2026-10-08T08:00:00Z' }, at('2026-10-09T00:00:00Z')),
    ).toBe(false);
  });
  it('never shows to a client who was never in the simple view', () => {
    expect(shouldShowFullMacrosIntro(emptyMacroDisplayRecord(), at('2026-10-09T00:00:00Z'))).toBe(false);
    expect(
      shouldShowFullMacrosIntro(rec({ mode: 'full', simpleUntil: '2026-10-08' }), at('2026-10-09T00:00:00Z')),
    ).toBe(false);
  });
});

describe('parseMacroDisplayRecord', () => {
  it('round-trips and rejects unknown versions', () => {
    const r = rec({ mode: 'simple', simpleUntil: '2026-10-08', seenSimple: true });
    expect(parseMacroDisplayRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(parseMacroDisplayRecord({ version: 2 })).toBeNull();
    expect(parseMacroDisplayRecord(null)).toBeNull();
  });
});

describe('surfaces', () => {
  it('Home shows calories and protein only in simple, the existing grid in full', () => {
    expect(homeCells('simple')).toEqual(['CALORIES', 'PROTEIN', 'WATER']);
    expect(homeCells('full')).toEqual(['PROTEIN', 'CARBS', 'FAT', 'WATER']);
  });
  it('Macros screen and pinned card show protein only beside calories in simple', () => {
    expect(targetCells('simple')).toEqual(['protein']);
    expect(targetCells('full')).toEqual(['protein', 'carbs', 'fat', 'fiber']);
  });
  it('Log food entries show protein only in simple', () => {
    const log = { protein: 30.4, carbs: 41.6, fat: 9.2 };
    expect(foodMacroLine(log, 'simple')).toBe('P: 30g');
    expect(foodMacroLine(log, 'full')).toBe('P: 30g · C: 42g · F: 9g');
  });
});
