/**
 * B-TEST (lens LO-910R2, m#910 review round 2, B3): a key held in a variable that is assigned again must be read
 * at every value it can hold, or reported. lookup() (test/savedKeyLifetimes/scanSavedKeys.ts:491-492) returns the
 * declaration's initializer only, so a later `key = ...`, `key += ...` or `K.a = ...` is dropped and the site is
 * reported as the registered first value: the key the app really saves is unregistered and case 1 stays green.
 * The LS-910 B5 class (reachable values discarded), for assignments instead of returns. Files are added under
 * src/ in memory only (fs is overlaid for the scan).
 */
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIR = 'src/lo910r2assign';
const AS = "import AsyncStorage from '@react-native-async-storage/async-storage';";
const FORMS: Array<[string, string, string]> = [
  ['let assigned in a branch', 'lo910r2.assigned',
    `${AS}\nexport async function g(x: boolean) {\n  let key = 'pending_invite_code';\n  if (x) key = 'lo910r2.assigned';\n  await AsyncStorage.setItem(key, '1');\n}`],
  ['let with +=', 'pending_invite_code_v2',
    `${AS}\nexport async function g() {\n  let key = 'pending_invite_code';\n  key += '_v2';\n  await AsyncStorage.setItem(key, '1');\n}`],
  ['object key property assigned', 'lo910r2.property',
    `${AS}\nconst K = { a: 'pending_invite_code' };\nK.a = 'lo910r2.property';\nexport const g = () => AsyncStorage.setItem(K.a, '1');`],
];

type Scan = { sites: Array<{ file: string; key: string }>; adapters: string[] };
function scanWith(files: Record<string, string>): Scan {
  const virtual = new Map(Object.entries(files).map(([n, src]) => [path.join(ROOT, DIR, n), src]));
  const dirAbs = path.join(ROOT, DIR);
  let out: Scan | undefined;
  jest.isolateModules(() => {
    const real = jest.requireActual<typeof import('fs')>('fs');
    const dirent = (name: string, dir: boolean) => ({ name, isDirectory: () => dir, isFile: () => !dir });
    jest.doMock('fs', () => ({
      ...real,
      existsSync: (p: string) => virtual.has(String(p)) || real.existsSync(p),
      readFileSync: (p: string, ...rest: unknown[]) =>
        virtual.has(String(p)) ? virtual.get(String(p)) : (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest),
      readdirSync: (p: string, opts?: unknown) => {
        if (String(p) === dirAbs) return Object.keys(files).map((n) => dirent(n, false));
        const list = (real.readdirSync as (...a: unknown[]) => unknown[])(p, opts);
        return String(p) === path.join(ROOT, 'src') ? [...list, dirent('lo910r2assign', true)] : list;
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = require('../../test/savedKeyLifetimes/scanSavedKeys').scanSavedKeys();
  });
  return out!;
}

it('B-TEST LO-910R2 B3: a key variable assigned again is read at every value it can hold, or reported', () => {
  const unreported = FORMS.filter(([, saved, src]) => {
    const scan = scanWith({ 'use.ts': src });
    return !scan.sites.some((s) => s.file === `${DIR}/use.ts` && (s.key === saved || s.key.includes('*')));
  }).map(([name]) => name);
  expect(unreported).toEqual([]);
});
