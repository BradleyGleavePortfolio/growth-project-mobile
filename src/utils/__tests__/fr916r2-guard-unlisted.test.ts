/**
 * FR-916R2 F2 (own tests): the save-site guard (food1mSaveSites.test.ts), run unchanged over a food or water
 * save added where it does not look yet: a file it does not list, a save renamed on import, a save passed on
 * as a value, a save by a bracket. Each is a save whose day and key the guard could not follow, so each must
 * fail. Same harness as LO-916R2 (lo916r2-guard-mutations.test.ts).
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

// hooks/useFoodBrowse.ts reads food logs (logApi.getDaily) and is not a save site the guard lists.
const UNLISTED = 'hooks/useFoodBrowse.ts';

describe('FR-916R2 F2 guard: saves where the guard does not look yet', () => {
  it('control: the guard is green on the head as it is', () => {
    expect(guardRejects({})).toBe(false);
  });

  it('logApi.logFood taken into a local name, in a file the guard does not list, is rejected', () => {
    expect(guardRejects({ [UNLISTED]: `
export async function quickAdd(foodId: string) {
  const { logFood: send } = logApi;
  await send({ date: new Date().toISOString().slice(0, 10), meal_type: 'snack', food_item_id: foodId, quantity_multiplier: 1 });
}
` })).toBe(true);
  });

  it('a save helper renamed on import, in a file the guard does not list, called with a raw today, is rejected', () => {
    expect(guardRejects({ [UNLISTED]: `
import { submitSearchLogOnline as addFood } from '../utils/log/logSubmit';
export const addAgain = (food: SearchResult) =>
  addFood({ food, date: new Date().toISOString().slice(0, 10), mealType: 'snack', multiplier: 1 });
` })).toBe(true);
  });

  it('water saved by a bracket, in a file the guard does not list, is rejected', () => {
    expect(guardRejects({ [UNLISTED]: `
import { waterApi } from '../services/api';
export const sip = () => waterApi['log']({ amount_ml: 250 });
` })).toBe(true);
  });

  it('a save helper passed on as a value from a listed screen, then called with a raw today, is rejected', () => {
    expect(guardRejects({ 'screens/client/LogScreen.tsx': `
const saveLater = submitSearchLogOnline;
export const saveToday = (food: SearchResult) =>
  saveLater({ food, date: getTodayString(), mealType: 'snack', multiplier: 1 });
` })).toBe(true);
  });
});
