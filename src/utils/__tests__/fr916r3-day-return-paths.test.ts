import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import ts from 'typescript';

// FR-916R3 F1 (LS-916R3 B1, LO-916R3 C3 P4): the save guard follows every day takeLogDay can return.
// Same method as ls916r3-day-return-provenance: the real guard, unchanged, over one edit of the real screen.
function guardRejects(replacement?: string): boolean {
  const suite = fs.readFileSync(path.join(__dirname, 'food1mSaveSites.test.ts'), 'utf8');
  const callbacks: Array<() => void> = [];
  const alteredFs = {
    ...fs,
    readFileSync(file: fs.PathOrFileDescriptor, options: unknown) {
      const original = fs.readFileSync(file, options as never);
      if (!replacement || typeof file !== 'string' || !file.endsWith('/screens/client/LogScreen.tsx')) return original;
      const text = String(original);
      const before = text.indexOf('const takeLogDay = () => {');
      const after = text.indexOf('const takeLogDayRef', before);
      expect(before).toBeGreaterThan(-1);
      expect(after).toBeGreaterThan(before);
      const helper = text.slice(before, after);
      expect(helper).toContain('return day;');
      return text.slice(0, before) + helper.replace('return day;', replacement) + text.slice(after);
    },
  };
  vm.runInNewContext(ts.transpileModule(suite, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    __dirname, exports: {}, expect,
    require: (name: string) => name === 'fs' ? alteredFs : name === 'path' ? path : require(name),
    describe: (_name: string, run: () => void) => run(),
    it: (_name: string, run: () => void) => callbacks.push(run),
  });
  expect(callbacks).not.toHaveLength(0);
  try { callbacks.forEach((check) => check()); return false; } catch { return true; }
}

it.each([
  ['a conditional return with the stale day on one branch', 'return selectedOn ? day : selectedDate;'],
  ['a returned alias of the stale day', 'const shown = selectedDate;\n    return shown;'],
  ['an early return of the stale day before the rule result', 'if (!currentUser) return selectedDate;\n    return day;'],
  ['a returned alias of a raw today', 'const today = getTodayString();\n    return today;'],
  ['a day handed in from outside', 'return takeLogDayRef.current();'],
])('FR-916R3 F1: the save guard rejects takeLogDay with %s', (_label, replacement) => {
  expect(guardRejects(replacement)).toBe(true);
});

it.each([
  ['the unchanged helper', undefined],
  ['a returned alias of the rule result', 'const picked = day;\n    return picked;'],
  ['a conditional whose two branches are both the rule result', 'return currentUser ? day : day;'],
])('control: the save guard accepts %s', (_label, replacement) => {
  expect(guardRejects(replacement)).toBe(false);
});
