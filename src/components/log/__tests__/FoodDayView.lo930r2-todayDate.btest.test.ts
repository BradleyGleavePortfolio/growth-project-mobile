/**
 * LO-930R2 B1 B-TEST (m#930 @ 3989d064): the first-day page (C_first) and the now line show only when the day shown
 * is today (FoodDayView.tsx:146 isToday, :224 `if (!day && !isToday) return withTop(p.fallback)`). A test that
 * renders FoodDayGate or FoodDayView with a fixed date string as "today" passes only on that calendar day and
 * turns the required "Typecheck, lint, test" check red on every later day. Each such test must take today from
 * getTodayString() (as FoodDayView.test.tsx and FoodDayView.styleC.test.tsx do) or pin the clock.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../..');
const LITERAL_DAY = /selectedDate="\d{4}-\d{2}-\d{2}"/;
const PINS_CLOCK = /setSystemTime|useFakeTimers\(\{|jest\.mock\([^)]*utils\/date/;

function testFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : testFiles(p);
    return /\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

it('LO-930R2 B1: no Food day test treats a fixed date as today', () => {
  const offenders = testFiles(SRC)
    .filter((f) => !f.endsWith('lo930r2-todayDate.btest.test.ts'))
    .filter((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return /<FoodDay(Gate|View)\b/.test(text) && LITERAL_DAY.test(text) && !PINS_CLOCK.test(text);
    })
    .map((f) => path.relative(SRC, f))
    .sort();
  expect(offenders).toEqual([]);
});
