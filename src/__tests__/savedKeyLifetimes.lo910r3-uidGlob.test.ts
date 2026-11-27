/**
 * B-TEST (lens LO-910R3, m#910 review round 3, B2): a key the app saves with no account id in it must not be
 * taken as an account-keyed row. The scan writes every part it cannot read (the account id among them) as '*', so
 * a literal key never holds an account id. The contract's row match (src/__tests__/savedKeyLifetimes.test.ts:73-79)
 * turns `{uid}` into `.*`, so `messages_thread_outbox_pending` (one queue for the whole phone) falls under the keyed
 * QUEUE row `messages_thread_outbox_{uid}`, and `roman_join_offer:shown` under the keyed MARK `roman_join_offer:{uid}`:
 * case 1 stays green and the keyed rule passes on the row's pattern, while the real key is shared by every account
 * on the phone. A key that adds a part after the account id (`gp_chat_${uid}_pinned`) is taken as the row too.
 *
 * The row match is read from the contract file itself (its glob, exact and rowOf lines, compiled as written), the
 * keys from the real scan over files added under src/ in memory only (fs is overlaid, nothing is written to disk).
 * Passes when none of these sites has a row, so case 1 names each one.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { REGISTRY } from '../../test/savedKeyLifetimes/savedKeyRegistry';

const ROOT = path.resolve(__dirname, '../..');
const DIR = 'src/lo910r3glob';
const FILES: Record<string, string> = {
  'use.ts': "import AsyncStorage from '@react-native-async-storage/async-storage';\n" +
    'export async function g(uid: string) {\n' +
    "  await AsyncStorage.setItem('messages_thread_outbox_pending', '[]');\n" +
    "  await AsyncStorage.setItem('roman_join_offer:shown', '1');\n" +
    '  await AsyncStorage.setItem(`gp_chat_${uid}_pinned`, \'[]\');\n' +
    '}',
};
const NEW_KEYS = ['messages_thread_outbox_pending', 'roman_join_offer:shown', 'gp_chat_*_pinned'];

type Site = { file: string; key: string; store: string };
function scanWith(files: Record<string, string>): Site[] {
  const virtual = new Map(Object.entries(files).map(([n, src]) => [path.join(ROOT, DIR, n), src]));
  const dirAbs = path.join(ROOT, DIR);
  let out: Site[] = [];
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
        return String(p) === path.join(ROOT, 'src') ? [...list, dirent('lo910r3glob', true)] : list;
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = require('../../test/savedKeyLifetimes/scanSavedKeys').scanSavedKeys().sites;
  });
  return out;
}

/** The contract's own row match, compiled from its source lines. */
function contractRowOf(): (site: Site) => unknown {
  const src = fs.readFileSync(path.join(ROOT, 'src/__tests__/savedKeyLifetimes.test.ts'), 'utf8');
  const pick = (name: string) => {
    const m = new RegExp(`^const ${name} = [\\s\\S]*?;$`, 'm').exec(src);
    if (!m) throw new Error(`savedKeyLifetimes.test.ts has no ${name}`);
    return m[0];
  };
  const body = ['glob', 'exact', 'globRows', 'rowOf'].map(pick).join('\n');
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('REGISTRY', `${js}\nreturn rowOf;`)(REGISTRY) as (site: Site) => unknown;
}

it('B-TEST LO-910R3 B2: a key with no account id in it, or with a part after it, is not taken as a {uid} row', () => {
  const rowOf = contractRowOf();
  const sites = scanWith(FILES).filter((s) => s.file === `${DIR}/use.ts`);
  expect(sites.map((s) => s.key).sort()).toEqual([...NEW_KEYS].sort());
  const absorbed = sites.filter((s) => rowOf(s)).map((s) => s.key);
  expect(absorbed).toEqual([]);
});
