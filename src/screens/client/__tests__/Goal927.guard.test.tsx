/**
 * GOAL-927-M guard (the shape of planStyleC.guard.test.tsx): the meal plan, Macro targets and Fasting a round
 * toward C2 C_day, K5 C_macros (nearest) and C8 C_fasting take every colour from a theme token, never clip or
 * shrink text that can grow at 130 percent, and keep every tap at 44 pt or more.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const FILES = [
  'src/screens/client/ClientDailyMealPlanScreen.tsx',
  'src/screens/client/ClientMacrosScreen.tsx',
  'src/screens/client/FastingScreen.tsx',
  'src/screens/client/mealplan/planStyleC.tsx',
  'src/components/mealplan/LogPlannedMealButton.tsx',
];
// Comments name owner ids ("#203-E33") and the drawings' hexes in prose; only code is checked.
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe.each(FILES)('%s', (file) => {
  it('takes every colour from a token: no hex, rgb( or rgba( literal', () => {
    const src = code(file);
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(src.match(/\brgba?\(/g) ?? []).toEqual([]);
  });

  it('never clips, shrinks or freezes text that can grow at 130 percent', () => {
    const src = code(file);
    expect(src.match(/numberOfLines|adjustsFontSizeToFit|allowFontScaling=\{false\}/g) ?? []).toEqual([]);
  });

  it('every pressable style it names keeps a 44 pt floor', () => {
    const src = code(file);
    // Each minHeight / height / width set on a tap target in these files is 44 pt or more (layout.touchMin,
    // layout.buttonHeight or a literal); a literal under 44 on a min size fails (minWidth 0 is the flex-shrink idiom, not a size).
    const small = [...src.matchAll(/min(Height|Width):\s*(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[2])).filter((n) => n > 0 && n < 44);
    expect(small).toEqual([]);
  });
});

it('the drawn parts use the touch floor tokens (C_day .btn 54 pt, .c-now 44 pt) (layout.touchMin, layout.buttonHeight)', () => {
  const plan = code('src/screens/client/mealplan/planStyleC.tsx');
  expect(plan).toMatch(/layout\.buttonHeight/);
  expect(plan).toMatch(/layout\.touchMin/);
});
