import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import ts from 'typescript';

it('LS-916 B3: the save-site guard rejects an additional keyed save that bypasses the day rule in a listed file', () => {
  const suite = fs.readFileSync(path.join(__dirname, 'food1mSaveSites.test.ts'), 'utf8');
  const extraSave = `
async function anAdditionalFoodSave(args: SearchLogArgs) {
  const nextDate = getTodayString();
  await submitSearchLogOnline({ ...args, date: nextDate });
}
`;
  const callbacks: Array<() => void> = [];
  const alteredFs = {
    ...fs,
    readFileSync(file: fs.PathOrFileDescriptor, options: unknown) {
      const original = fs.readFileSync(file, options as never);
      return typeof file === 'string' && file.endsWith('/screens/client/LogScreen.tsx')
        ? `${original}${extraSave}` : original;
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
  // Do not change the builder's assertions: execute all of them, unchanged,
  // over the one additional save, and require at least one to reject it.
  expect(() => callbacks.forEach((check) => check())).toThrow();
});
