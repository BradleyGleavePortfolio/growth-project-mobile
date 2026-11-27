/**
 * B-TEST (lens LO-910R2, m#910 review round 2, B1): a wrapper that saves the key it is given must be read, or
 * reported, at every caller. Each form below adds files under src/ in memory only (fs is overlaid for the scan,
 * nothing is written to disk): wrap.ts holds saveFlag(key) -> AsyncStorage.setItem(key), and one caller reaches
 * it lazily, the way src/screens/onboarding/OnboardingResults.tsx:52 reaches utils/onboardingStore. The form
 * passes only if the scan reports a site for the caller's file (its key, or '*' so case 1 goes red) or an
 * adapter there (case 3 goes red). At 7151e75a all three return no site and no adapter: the key is saved,
 * unregistered, and case 1 stays green.
 */
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIR = 'src/lo910r2lazy';
const WRAP = "import AsyncStorage from '@react-native-async-storage/async-storage';\n" +
  "export async function saveFlag(key: string) { await AsyncStorage.setItem(key, '1'); }";
const FORMS: Array<[string, string]> = [
  ['await import, destructured', "export async function g() {\n  const { saveFlag } = await import('./wrap');\n  await saveFlag('lo910r2.importDestructured');\n}"],
  ['await import, member call', "export async function g() {\n  await (await import('./wrap')).saveFlag('lo910r2.importMember');\n}"],
  ['require', "export function g() {\n  return require('./wrap').saveFlag('lo910r2.require');\n}"],
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
        return String(p) === path.join(ROOT, 'src') ? [...list, dirent('lo910r2lazy', true)] : list;
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = require('../../test/savedKeyLifetimes/scanSavedKeys').scanSavedKeys();
  });
  return out!;
}

it('B-TEST LO-910R2 B1: a key-saving wrapper reached by import() or require() is read or reported', () => {
  const unreported = FORMS.filter(([, caller]) => {
    const scan = scanWith({ 'wrap.ts': WRAP, 'use.ts': caller });
    const file = `${DIR}/use.ts`;
    return !scan.sites.some((s) => s.file === file && (s.key.startsWith('lo910r2.') || s.key.includes('*'))) &&
      !scan.adapters.some((a) => a.startsWith(`${file}:`));
  }).map(([name]) => name);
  expect(unreported).toEqual([]);
});
