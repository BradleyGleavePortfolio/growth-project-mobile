/**
 * B-TEST (lens LO-910R3, m#910 review round 3, B4): the LO-910R2 B3 class (a key binding changed after its
 * declaration) across files. FR-910R2 reads a property write to a key object in the file that declares it; a write
 * to an imported key object (in the importer, or in a third file) is not seen, and the scan reads the key at its
 * first, registered value. Each form adds files under src/ in memory only (fs is overlaid, nothing is written to
 * disk). A form passes if the scan reports the new key, or '*' (case 1 goes red). At d98074df both forms give one
 * site with the registered key 'pending_invite_code' and nothing else: the key really saved has no row.
 */
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIR = 'src/lo910r3mut';
const AS = "import AsyncStorage from '@react-native-async-storage/async-storage';\n";
const KEYS = "export const K = { invite: 'pending_invite_code' };";
const FORMS: Array<[string, Record<string, string>]> = [
  ['imported key object changed in the importer', {
    'keys.ts': KEYS,
    'use.ts': AS + "import { K } from './keys';\nK.invite = 'lo910r3.importer';\n" +
      "export function g() {\n  return AsyncStorage.setItem(K.invite, '1');\n}",
  }],
  ['imported key object changed in a third file', {
    'keys.ts': KEYS,
    'v2.ts': "import { K } from './keys';\nexport function useV2() {\n  K.invite = 'lo910r3.third';\n}",
    'use.ts': AS + "import { K } from './keys';\nexport function g() {\n  return AsyncStorage.setItem(K.invite, '1');\n}",
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
        return String(p) === path.join(ROOT, 'src') ? [...list, dirent('lo910r3mut', true)] : list;
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = require('../../test/savedKeyLifetimes/scanSavedKeys').scanSavedKeys();
  });
  return out!;
}

it('B-TEST LO-910R3 B4: a key object changed through an import is read at every value or reported', () => {
  const unreported = FORMS.filter(([, files]) => {
    const sites = scanWith(files).sites.filter((s) => s.file.startsWith(`${DIR}/`));
    return !sites.some((s) => s.key.startsWith('lo910r3.') || s.key.includes('*'));
  }).map(([name]) => name);
  expect(unreported).toEqual([]);
});
