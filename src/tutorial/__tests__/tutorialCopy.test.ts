/**
 * Roman's tutorial copy obeys the butler voice contract
 * (AI_BUTLER_ROMAN_IDENTITY_SPEC §1) and the Quiet Luxury doctrine §4, and
 * every number it speaks is the real one from the payload.
 */
import { TUTORIAL_STEPS, wearableName, type CopyContext } from '../tutorialSteps';

const CTX: CopyContext = {
  firstName: 'Maya',
  coachName: 'Bradley',
  program: { id: 'p1', name: 'Foundations', days_per_week: 3, weeks: 4, why: ['a', 'b', 'c'] },
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50 },
  spaces: [
    { id: 's1', name: 'All members' },
    { id: 's2', name: 'Foundations group' },
  ],
  platform: 'ios',
};

const SPARSE: CopyContext = {
  firstName: null,
  coachName: 'your coach',
  program: null,
  macros: null,
  spaces: [],
  platform: 'android',
};

function allLines(ctx: CopyContext): string[] {
  const out: string[] = [];
  for (const s of TUTORIAL_STEPS) {
    for (const g of s.gates) out.push(g.line(ctx));
    if (s.doneLine) out.push(s.doneLine(ctx));
    if (s.pendingLine) out.push(s.pendingLine(ctx));
  }
  return out;
}

const BANNED = [
  'amazing', 'incredible', 'awesome', 'epic', 'insane', 'game-changer', 'crushing it',
  "let's go", 'beast mode', 'grind', 'congratulations', 'oops', 'hey', 'guys', 'coming soon',
];

describe.each([
  ['full context', CTX],
  ['sparse context', SPARSE],
])('tutorial copy (%s)', (_name, ctx) => {
  const lines = allLines(ctx);

  it('has no exclamation points', () => {
    expect(lines.filter((l) => l.includes('!'))).toEqual([]);
  });

  it('has no emoji or pictographs', () => {
    expect(lines.filter((l) => /\p{Extended_Pictographic}/u.test(l))).toEqual([]);
  });

  it('has no em dashes', () => {
    expect(lines.filter((l) => /\u2014/.test(l))).toEqual([]);
  });

  it('avoids contractions (Roman cadence)', () => {
    const re = /\b\w+'(t|ll|re|ve|d|m)\b|\b(it|that|there|what|here|let)'s\b/i;
    expect(lines.filter((l) => re.test(l))).toEqual([]);
  });

  it('uses no banned hype or slang', () => {
    const bad = lines.filter((l) => BANNED.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(l)));
    expect(bad).toEqual([]);
  });

  it('never leaves an unfilled placeholder', () => {
    expect(lines.filter((l) => /undefined|null|NaN|\$\{/.test(l))).toEqual([]);
  });

  it('ends every line with terminal punctuation', () => {
    expect(lines.filter((l) => !/[.?]$/.test(l.trim()))).toEqual([]);
  });
});

describe('real numbers', () => {
  it('speaks the payload macros and plan exactly', () => {
    const lines = allLines(CTX).join('\n');
    expect(lines).toContain('1,789 calories');
    expect(lines).toContain('150 grams of protein');
    expect(lines).toContain('185 grams of carbohydrate');
    expect(lines).toContain('50 grams of fat');
    expect(lines).toContain('Foundations: 4 weeks, 3 days a week.');
    expect(lines).toContain('All members and Foundations group');
    expect(lines).toContain('Welcome, Maya.');
  });

  it('names the platform health store', () => {
    expect(wearableName(CTX)).toBe('Apple Health');
    expect(wearableName(SPARSE)).toBe('Health Connect');
    const wear = TUTORIAL_STEPS.find((s) => s.id === 'wearables')!;
    expect(wear.gates[0].line(CTX)).toContain('Apple Health');
    expect(wear.gates[0].line(SPARSE)).toContain('Health Connect');
  });
});
