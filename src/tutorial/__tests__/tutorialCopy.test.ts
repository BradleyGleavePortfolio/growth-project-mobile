/**
 * Roman's tutorial copy obeys the butler voice contract
 * (AI_BUTLER_ROMAN_IDENTITY_SPEC §1) and the Quiet Luxury doctrine §4, and
 * every number it speaks is the real one from the payload.
 */
import { pushPrimingLine, TUTORIAL_STEPS, type CopyContext } from '../tutorialSteps';

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
  coachLinked: true,
  calendarAvailable: true,
  communityAvailable: true,
  outcomes: { plan: 'done', macros: 'done', first_message: 'done' },
};

const SPARSE: CopyContext = {
  firstName: null,
  coachName: 'your coach',
  program: null,
  macros: null,
  spaces: [],
  platform: 'android',
};

const SIMPLE: CopyContext = { ...CTX, macroMode: 'simple' };

function allLines(ctx: CopyContext): string[] {
  const out: string[] = [];
  for (const s of TUTORIAL_STEPS) {
    for (const g of s.gates) {
      out.push(g.line(ctx));
      if (g.sub) out.push(g.sub(ctx));
    }
    if (s.doneLine) out.push(s.doneLine(ctx));
    if (s.pendingLine) out.push(s.pendingLine(ctx));
  }
  out.push(pushPrimingLine(ctx));
  return out;
}

const BANNED = [
  'amazing', 'incredible', 'awesome', 'epic', 'insane', 'game-changer', 'crushing it',
  "let's go", 'beast mode', 'grind', 'congratulations', 'oops', 'hey', 'guys', 'coming soon',
];

describe.each([
  ['full context', CTX],
  ['sparse context', SPARSE],
  ['simple macro view', SIMPLE],
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
  it('speaks the payload macros, plan and names exactly', () => {
    const lines = allLines(CTX).join('\n');
    expect(lines).toContain('1,789 calories');
    expect(lines).toContain('150 grams of protein');
    expect(lines).toContain('185 grams of carbohydrate');
    expect(lines).toContain('50 grams of fat');
    expect(lines).toContain('Bradley assigned you Foundations.');
    expect(lines).toContain('Welcome, Maya.');
  });
});

describe('prototype copy (46-61), re-voiced without contractions', () => {
  const line = (id: string, gate = 0, ctx = CTX) => TUTORIAL_STEPS.find((s) => s.id === id)!.gates[gate].line(ctx);
  it('welcome, Train, Food, targets, coach and completion', () => {
    expect(line('welcome')).toBe(
      'Welcome, Maya. I am Roman. I work with Bradley to help you get the most from your plan. This takes about two minutes. I will show you where everything lives.',
    );
    expect(line('plan')).toBe('This is Train. Bradley assigned you Foundations. Tap Train to see it.');
    expect(line('first_exercise')).toContain('tap Start workout. There is no need to do that now.');
    expect(line('first_meal')).toMatch(/^This is Food\./);
    expect(line('macros', 1)).toContain('Bradley set these for you.');
    expect(line('first_message')).toContain('A real person, not me.');
    expect(line('complete')).toBe(
      'That is everything, Maya. Your plan is set, your numbers are set, and Bradley has your message.',
    );
  });

  it('folds Calendar, Community and devices into the completion (decision 133-5)', () => {
    const sub = TUTORIAL_STEPS.find((s) => s.id === 'complete')!.gates[0].sub!;
    expect(sub(CTX)).toBe(
      'Calendar and Community have their own tabs, and connected devices live under You. Book your welcome call with Bradley from Calendar when it suits you. One thing at a time. You do not need to be perfect, just consistent.',
    );
    expect(sub({ ...CTX, calendarAvailable: false, communityAvailable: false })).toMatch(/^Connected devices live under You\. One thing/);
    expect(sub({ ...CTX, coachLinked: false })).not.toContain('welcome call');
  });

  it('a client without a coach hears no coach name anywhere', () => {
    const ctx: CopyContext = { ...CTX, coachLinked: false, outcomes: { plan: 'done', macros: 'done' } };
    const lines = TUTORIAL_STEPS.filter((s) => s.id !== 'first_message')
      .flatMap((s) => [...s.gates.map((g) => g.line(ctx)), s.doneLine?.(ctx) ?? '', s.pendingLine?.(ctx) ?? ''])
      .concat(pushPrimingLine(ctx))
      .join(' ');
    expect(lines).not.toContain('Bradley');
    expect(line('roman', 0, ctx)).toContain('once you join a coach');
  });
});

describe('fix round (audit B1, C1)', () => {
  const meal = TUTORIAL_STEPS.find((s) => s.id === 'first_meal')!;

  it('the first-meal step points at a food entry and never invites water (B1)', () => {
    const lines = meal.gates.map((g) => g.line(CTX)).join(' ');
    expect(lines).not.toMatch(/water|drunk|drink/i);
    expect(lines).toContain('Add food');
    expect(meal.title).toBe('Log your first meal');
    const gate = meal.gates[1];
    expect(gate.kind === 'signal' && gate.signal).toBe('meal_logged');
  });

  it.each([
    ['full', CTX],
    ['sparse', SPARSE],
  ])('makes no promise the app does not keep (%s)', (_n, ctx) => {
    const lines = allLines(ctx).join('\n');
    expect(lines).not.toMatch(/let you know/i);
    expect(lines).not.toMatch(/reply soon|will reply|will get back/i);
    expect(lines).not.toMatch(/notify you|send you a notification/i);
  });

  it('pending and sent lines say only what the app does', () => {
    const plan = TUTORIAL_STEPS.find((s) => s.id === 'plan')!;
    const macros = TUTORIAL_STEPS.find((s) => s.id === 'macros')!;
    const msg = TUTORIAL_STEPS.find((s) => s.id === 'first_message')!;
    expect(plan.pendingLine!(CTX)).toContain('It will appear on Train once it is ready.');
    expect(macros.pendingLine!(CTX)).toContain('They will appear on Home once they are ready.');
    expect(msg.doneLine!(CTX)).toBe('Sent. Bradley will see it in your conversation.');
  });
});

describe('lighter start: the macro step in the simple view', () => {
  const step = TUTORIAL_STEPS.find((s) => s.id === 'macros')!;

  it('Roman keeps it to two numbers and explains why', () => {
    const line = step.gates[1].line(SIMPLE);
    expect(line).toMatch(/^This first week keeps it to two numbers: 1,789 calories and 150 grams of protein\./);
    expect(line).toContain('Carbohydrate and fat are already worked out');
    expect(line).not.toMatch(/185|\b50 grams/);
    expect(line).toMatch(/Tap How to use these numbers any time for what each one means\.$/);
  });

  it('full (or absent) mode speaks all four numbers', () => {
    const full = step.gates[1].line(CTX);
    expect(full).toContain('185 grams of carbohydrate and 50 grams of fat');
    expect(step.gates[1].line({ ...CTX, macroMode: 'full' })).toBe(full);
  });
});
