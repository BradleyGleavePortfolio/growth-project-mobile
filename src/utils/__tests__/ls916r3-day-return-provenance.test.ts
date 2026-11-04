import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import ts from 'typescript';

// Run the actual save-site guard unchanged against one edit of the actual screen.
// The guard must follow the day returned by takeLogDay, not an unrelated call in it.
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

it('control: the unchanged screen passes the real save-site guard', () => {
  expect(guardRejects()).toBe(false);
});

it.each([
  ['the stale selected day', 'return selectedDate;'],
  ['a raw today instead of an explicitly browsed day', 'return getTodayString();'],
])('LS-916R3 B1: the save guard rejects takeLogDay returning %s', (_label, replacement) => {
  expect(guardRejects(replacement)).toBe(true);
});
