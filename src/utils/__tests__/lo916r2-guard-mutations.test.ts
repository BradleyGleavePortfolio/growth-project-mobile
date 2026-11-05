/**
 * LO-916R2 (m#916 @ a745f11a): the save-site guard (food1mSaveSites.test.ts), run unchanged over one
 * added food save in a listed file, must fail when that save's day is not the captured log day or its
 * client_uuid is not the withSaveKey key. Same harness as LS-916 B3 (ls916-day-guard-mutation.test.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import ts from 'typescript';

function guardRejects(extra: Record<string, string>): boolean {
  const suite = fs.readFileSync(path.join(__dirname, 'food1mSaveSites.test.ts'), 'utf8');
  const callbacks: Array<() => void> = [];
  const alteredFs = {
    ...fs,
    readFileSync(file: fs.PathOrFileDescriptor, options: unknown) {
      const original = fs.readFileSync(file, options as never);
      if (typeof file !== 'string') return original;
      const hit = Object.keys(extra).find((rel) => file.endsWith(`/${rel}`));
      return hit ? `${original}${extra[hit]}` : original;
    },
  };
  const compiled = ts.transpileModule(suite, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  vm.runInNewContext(compiled.outputText, {
    __dirname, exports: {}, expect,
    require: (name: string) => name === 'fs' ? alteredFs : name === 'path' ? path : require(name),
    describe: (_name: string, run: () => void) => run(),
    it: (_name: string, run: () => void) => callbacks.push(run),
  });
  expect(callbacks).not.toHaveLength(0);
  try { callbacks.forEach((check) => check()); return false; } catch { return true; }
}

describe('LO-916R2 guard mutations', () => {
  it('control: the guard is green on the head as it is', () => {
    expect(guardRejects({})).toBe(false);
  });

  it('control: logApi.logFood with the screen day and a made-up key is rejected', () => {
    expect(guardRejects({ 'screens/client/LogScreen.tsx': `
async function aDirectSave(food: SearchResult) {
  await logApi.logFood({ date: getTodayString(), meal_type: 'lunch', food_item_id: food.id, quantity_multiplier: 1, client_uuid: String(Date.now()) });
}
` })).toBe(true);
  });

  it('logApi.logFood taken into a local name, with a raw today and a made-up key, is rejected', () => {
    expect(guardRejects({ 'screens/client/LogScreen.tsx': `
async function anAliasedSave(food: SearchResult) {
  const { logFood: send } = logApi;
  await send({ date: getTodayString(), meal_type: 'lunch', food_item_id: food.id, quantity_multiplier: 1, client_uuid: String(Date.now()) });
}
` })).toBe(true);
  });

  it('a new keyed save helper in logSubmit.ts, called from the screen with a raw today, is rejected', () => {
    expect(guardRejects({
      'utils/log/logSubmit.ts': `
export async function submitFoodAgain(args: SearchLogArgs) {
  const { log } = searchSave(args);
  await withSaveKey(['again'], (key) => logApi.logFood({ ...log, food_item_id: args.food.id, client_uuid: key }));
}
`,
      'screens/client/LogScreen.tsx': `
async function aStaleDaySave(args: Parameters<typeof submitFoodAgain>[0]) {
  await submitFoodAgain({ ...args, date: getTodayString() });
}
`,
    })).toBe(true);
  });
});
