import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import ts from 'typescript';

it.each([
  ['day overwritten after capture', `
async function anotherSave(args: SearchLogArgs) {
  let date = takeLogDay();
  date = getTodayString();
  await submitSearchLogOnline({ ...args, date });
}`],
  ['day overwritten by the later conditional spread', `
async function anotherSave(args: SearchLogArgs, useCurrent: boolean) {
  const date = takeLogDay();
  const override = useCurrent ? { date: getTodayString() } : {};
  await submitSearchLogOnline({ ...args, date, ...override });
}`],
  ['client key overwritten by a later spread', `
async function anotherSave() {
  const date = takeLogDay();
  await withSaveKey(['new', date], (key) =>
    logApi.logFood({ date, food_item_id: 'oats', meal_type: 'breakfast',
      client_uuid: key, ...{ client_uuid: newSaveKey() } }));
}`],
])('LS-916R2 B2: the save guard rejects %s', (_label, extraSave) => {
  const suite = fs.readFileSync(path.join(__dirname, 'food1mSaveSites.test.ts'), 'utf8');
  const callbacks: Array<() => void> = [];
  const alteredFs = {
    ...fs,
    readFileSync(file: fs.PathOrFileDescriptor, options: unknown) {
      const original = fs.readFileSync(file, options as never);
      return typeof file === 'string' && file.endsWith('/screens/client/LogScreen.tsx')
        ? `${original}${extraSave}` : original;
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
  expect(() => callbacks.forEach((check) => check())).toThrow();
});
