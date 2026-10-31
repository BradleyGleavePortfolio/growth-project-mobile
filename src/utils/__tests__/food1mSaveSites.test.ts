/**
 * FOOD-1-M class-first list: every place the phone saves a food or water log (online, queued, retried),
 * with the key it sends and the day rule it calls. A new file that saves a food or water log fails
 * here until it is listed, keyed (R3) and on the shared day rule (R2).
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..');
const SAVE = /\b(logFood|waterApi\.log|enqueueFoodLog|submit(Search|Manual)Log\w*|repeatPastMeal|logWater)\(|'\/log\/food'|'\/nutrition\/water'/;
const DEFINITION = /function\s+$/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : files(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** The text of each call `name(...)` in `src`, to its closing parenthesis. */
function calls(src: string, name: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf(`${name}(`); i >= 0; i = src.indexOf(`${name}(`, i + 1)) {
    if (DEFINITION.test(src.slice(Math.max(0, i - 20), i))) continue;
    let depth = 0;
    let j = i + name.length;
    do { depth += src[j] === '(' ? 1 : src[j] === ')' ? -1 : 0; j += 1; } while (depth > 0 && j < src.length);
    out.push(src.slice(i, j));
  }
  return out;
}

// file | what it saves | key (R3) | day (R2) | behaviour test
const SITES: Record<string, string> = {
  'services/api.ts': 'the two routes: logApi.logFood (client_uuid + Idempotency-Key header), waterApi.log (header)',
  'services/foodLogQueue.ts': 'queued food, flushed and retried: key = the entry id (made at the tap or handed on from the online try)',
  'utils/log/logSubmit.ts': 'search and manual food, online and queued: withSaveKey (food1mSaveKeys.test.ts)',
  'utils/log/quickLog.ts': 'a repeated past meal, one save per food: withSaveKey (food1mSaveKeys.test.ts)',
  'store/clientStore.ts': 'logWater (and logFood, no app caller): withSaveKey; logWater day: dayForNewLog (LogScreen.food1mMidnight.test.tsx)',
  'screens/client/LogScreen.tsx': 'search, manual, plan and repeat food, and water through the store: day takeLogDay -> dayForNewLog (LogScreen.food1mMidnight.test.tsx, loFoodNextMorning)',
  'components/mealplan/LogPlannedMealButton.tsx': 'a plan meal, online or queued: logSubmit keys; day dayForNewLog() (LogPlannedMealButton.test.tsx)',
  'components/home/rings/HomeTiles.tsx': 'a glass of water through store.logWater (key and day in the store)',
};

describe('FOOD-1-M every food and water save', () => {
  it('lists every file that saves a food or water log', () => {
    const found = files(SRC)
      .filter((f) => SAVE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
      .sort();
    expect(found).toEqual(Object.keys(SITES).sort());
  });

  it('R3: every food save sends a client key, and every water save sends its key', () => {
    const unkeyed = Object.keys(SITES).flatMap((rel) => {
      const src = read(rel);
      return [
        ...calls(src, 'logApi.logFood').filter((c) => !/client_uuid/.test(c)),
        ...calls(src, 'waterApi.log').filter((c) => !/,\s*key\s*\)$/.test(c)),
        ...calls(src, 'enqueueFoodLog').filter((c) => !/,\s*key\s*\)$/.test(c)),
      ].map((c) => `${rel}: ${c.slice(0, 60)}`);
    });
    expect(unkeyed).toEqual([]);
    const logSubmit = read('utils/log/logSubmit.ts');
    for (const name of ['submitSearchLogOnline', 'submitSearchLogOffline', 'submitManualLogOnlineWithId', 'submitManualLogOffline']) {
      const body = logSubmit.slice(logSubmit.indexOf(`export async function ${name}(`));
      expect(body.slice(0, body.indexOf('\n}\n'))).toContain('withSaveKey(');
    }
  });

  it('R2: every save picks its day through the shared rule, never the stale screen day or a raw today', () => {
    const screen = read('screens/client/LogScreen.tsx');
    expect(screen).toContain('dayForNewLog({ selectedDate, selectedOn })');
    // search, manual, plan, repeat
    expect(screen.match(/const day = takeLogDay\(\);/g)).toHaveLength(4);
    const stale = Object.keys(SITES).flatMap((rel) => (read(rel).match(/date: (selectedDate|getTodayString\(\))\b|repeatPastMeal\(\w+, selectedDate/g) ?? [])
      .map((m) => `${rel}: ${m}`));
    expect(stale).toEqual([]);
    const store = read('store/clientStore.ts');
    const logWater = store.slice(store.indexOf('logWater: async'));
    expect(logWater.slice(0, logWater.indexOf('waterApi.log('))).toContain('dayForNewLog(get())');
    expect(read('components/mealplan/LogPlannedMealButton.tsx')).toContain('date: dayForNewLog()');
  });
});
