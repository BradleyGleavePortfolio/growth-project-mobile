/**
 * B-TEST (lens LO-910R3, m#910 review round 3, B1): a store or a key-saving wrapper reached through a module
 * namespace used other than by a plain member must be read, or reported. The app already loads a module this way
 * (src/screens/coach/programs/ProgramUi.tsx:41, `import("../../../services/authActions").then((m) => m.signOut())`).
 * Each form adds files under src/ in memory only (fs is overlaid for the scan, nothing is written to disk). A form
 * passes only if the scan reports a site in one of its files (its key, or '*' so case 1 goes red) or an adapter
 * there (case 3 goes red). At d98074df every form returns nothing: the key is saved, unregistered, case 1 green.
 * (The same form on expo-secure-store is reported: `then` becomes an unknown storage call.)
 */
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIR = 'src/lo910r3then';
const WRAP = "import AsyncStorage from '@react-native-async-storage/async-storage';\n" +
  "export async function saveFlag(key: string) { await AsyncStorage.setItem(key, '1'); }";
const FORMS: Array<[string, Record<string, string>]> = [
  ['store module, import().then', {
    'use.ts': "export function g() {\n  return import('@react-native-async-storage/async-storage')\n" +
      "    .then((m) => m.default.setItem('lo910r3.thenStore', '1'));\n}",
  }],
  ['wrapper module, import().then, member call', {
    'wrap.ts': WRAP,
    'use.ts': "export function g() {\n  return import('./wrap').then((m) => m.saveFlag('lo910r3.thenWrap'));\n}",
  }],
  ['wrapper module, import().then, destructured', {
    'wrap.ts': WRAP,
    'use.ts': "export function g() {\n  return import('./wrap').then(({ saveFlag }) => saveFlag('lo910r3.thenDestructured'));\n}",
  }],
  ['wrapper namespace spread into an exported object', {
    'wrap.ts': WRAP,
    'barrel.ts': "import * as w from './wrap';\nexport const api = { ...w };",
    'use.ts': "import { api } from './barrel';\nexport function g() {\n  return api.saveFlag('lo910r3.spread');\n}",
  }],
  ['wrapper namespace handed to a function', {
    'wrap.ts': WRAP,
    'use.ts': "import * as w from './wrap';\nconst run = (m: typeof w) => m.saveFlag('lo910r3.handed');\n" +
      'export function g() {\n  return run(w);\n}',
  }],
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
        return String(p) === path.join(ROOT, 'src') ? [...list, dirent('lo910r3then', true)] : list;
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = require('../../test/savedKeyLifetimes/scanSavedKeys').scanSavedKeys();
  });
  return out!;
}

it('control: the overlay is read (a plain member call through the same namespace is reported)', () => {
  const scan = scanWith({
    'wrap.ts': WRAP,
    'use.ts': "import * as w from './wrap';\nexport function g() {\n  return w.saveFlag('lo910r3.control');\n}",
  });
  expect(scan.sites.some((s) => s.file === `${DIR}/use.ts` && s.key === 'lo910r3.control')).toBe(true);
});

it('B-TEST LO-910R3 B1: a store or wrapper reached through import().then or a passed-on namespace is read or reported', () => {
  const unreported = FORMS.filter(([, files]) => {
    const scan = scanWith(files);
    const mine = (f: string) => f.startsWith(`${DIR}/`) && f !== `${DIR}/wrap.ts`;
    return !scan.sites.some((s) => mine(s.file) && (s.key.startsWith('lo910r3.') || s.key.includes('*'))) &&
      !scan.adapters.some((a) => mine(a.split(':')[0]));
  }).map(([name]) => name);
  expect(unreported).toEqual([]);
});
