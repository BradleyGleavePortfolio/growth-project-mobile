/**
 * FR-910R2 (LS-910R2 B1, LO-910R2 B1 to B3): the scan reads a saved key through every way a store or a key-saving
 * wrapper can be reached, and through every value a key binding can hold, or reports it ('*'). Each row is a
 * parser-only tree (the production tree is not edited); the rows with no storage show the scan adds nothing of its own.
 */
import * as path from 'path';
import type { KeySite, Scan } from '../../test/savedKeyLifetimes/scanSavedKeys';

const AS = "import disk from '@react-native-async-storage/async-storage';";
const WRITER = `${AS} export function save(k: string) { return disk.setItem(k, '1'); }`;

/** Scans `files` as the app: src/ is exactly the files given; a root file given replaces the real one. */
function scanTree(files: Record<string, string>): Scan {
  const root = process.cwd();
  let result: Scan | undefined;
  jest.isolateModules(() => {
    const actual = jest.requireActual<typeof import('fs')>('fs');
    const rel = (value: unknown) => path.relative(root, String(value)).split(path.sep).join('/');
    jest.doMock('fs', () => ({
      ...actual,
      existsSync: (value: unknown) => {
        const file = rel(value);
        if (Object.hasOwn(files, file)) return true;
        return file.startsWith('src/') ? false : actual.existsSync(String(value));
      },
      readFileSync: (value: unknown, ...args: unknown[]) => {
        const file = rel(value);
        return Object.hasOwn(files, file) ? files[file]
          : (actual.readFileSync as (...a: unknown[]) => unknown)(value, ...args);
      },
      readdirSync: (value: unknown, options: unknown) => {
        const dir = rel(value);
        if (dir !== 'src' && !dir.startsWith('src/')) {
          return (actual.readdirSync as (...a: unknown[]) => unknown)(value, options);
        }
        const prefix = `${dir}/`;
        return [...new Set(Object.keys(files).filter((f) => f.startsWith(prefix))
          .map((f) => f.slice(prefix.length).split('/')[0]))].map((name) => ({
          name,
          isDirectory: () => Object.keys(files).some((f) => f.startsWith(`${prefix}${name}/`)),
        }));
      },
    }));
    result = jest.requireActual<typeof import('../../test/savedKeyLifetimes/scanSavedKeys')>(
      '../../test/savedKeyLifetimes/scanSavedKeys',
    ).scanSavedKeys();
  });
  jest.dontMock('fs');
  return result!;
}

const keysOf = (scan: Scan) => [...new Set(scan.sites.map((s: KeySite) => `${s.store} ${s.key}`))].sort();

type Row = [name: string, files: Record<string, string>, expected: string[]];
const rows: Row[] = [
  // controls
  ['control: no storage at all reads nothing (the real index.ts and App.tsx add no key here)', { 'src/probe.ts': 'export const a = 1;' }, []],
  ['control: a direct save', { 'src/probe.ts': `${AS} disk.setItem('k.direct', '1');` }, ['async k.direct']],
  ['control: a wrapper called by name', { 'src/probe.ts': "import { save } from './w/writer'; save('k.named');", 'src/w/writer.ts': WRITER }, ['async k.named']],
  // a store loaded in place
  ['inline require of the secure store', { 'src/probe.ts': "require('expo-secure-store').setItemAsync('k.secure', '1');" }, ['secure-store k.secure']],
  ['inline import, read later', { 'src/probe.ts': "export async function f() { const m = (await import('@react-native-async-storage/async-storage')).default; await m.setItem('k.later', '1'); }" }, ['async k.later']],
  // a barrel with two hops, every way in
  ...((): Row[] => {
    const tree = { 'src/w/writer.ts': WRITER, 'src/w/inner.ts': "export { save } from './writer';", 'src/w/outer.ts': "export * from './inner';" };
    const row = (name: string, code: string): Row => [`barrel with two hops: ${name}`, { ...tree, 'src/probe.ts': code }, ['async k.hop']];
    return [
      row('named import', "import { save } from './w/outer'; save('k.hop');"),
      row('namespace member', "import * as w from './w/outer'; w.save('k.hop');"),
      row('namespace by literal name', "import * as w from './w/outer'; w['save']('k.hop');"),
      row('require member', "require('./w/outer').save('k.hop');"),
      row('import() member', "export async function f() { (await import('./w/outer')).save('k.hop'); }"),
      row('import() destructured', "export async function f() { const { save } = await import('./w/outer'); save('k.hop'); }"),
      row('require() kept, then its member', "const w = require('./w/outer'); w.save('k.hop');"),
      row('re-exported import', "import { save } from './w/again'; save('k.hop');"),
    ].map(([n, f, e]): Row => [n, { ...f, 'src/w/again.ts': "import { save } from './outer'; export { save };" }, e]);
  })(),
  ['barrel with two hops: member picked at run time is reported', {
    'src/w/writer.ts': WRITER, 'src/w/inner.ts': "export { save } from './writer';", 'src/w/outer.ts': "export * from './inner';",
    'src/probe.ts': "import * as w from './w/outer'; const pick = String(Date.now()); (w as any)[pick]('k.hop');",
  }, ['async *']],
  // key built in a loop
  ['key built in a loop: a string added to', { 'src/probe.ts': `${AS} let k = 'k.loop'; for (const part of ['a', 'b']) k += part; disk.setItem(k, '1');` }, ['async *']],
  ['key built in a loop: assigned again in a while', { 'src/probe.ts': `${AS} let k = 'k.loop'; let i = 0; while (i++ < 3) { k = k + '.x'; } disk.setItem(k, '1');` }, ['async *']],
  ['key built in a loop: a list pushed to', { 'src/probe.ts': `${AS} const ks: string[] = ['k.first']; for (let i = 0; i < 3; i += 1) ks.push(\`k.more.\${i}\`); disk.multiGet(ks);` }, ['async k.first', 'async k.more.*']],
  ['key built in a loop: an object written', { 'src/probe.ts': `${AS} const K = { a: 'k.obj' }; for (const x of ['1']) K.a = x; disk.setItem(K.a, '1');` }, ['async *']],
  ['key built in a loop: destructuring assignment', { 'src/probe.ts': `${AS} let k = 'k.obj'; for (const pair of [['x']]) [k] = pair; disk.setItem(k, '1');` }, ['async *']],
  ['control: a key never changed after its first value is read as written', { 'src/probe.ts': `${AS} let k = 'k.fixed'; disk.setItem(k, '1'); const other = 'x'; let k2 = other; k2 = 'y'; void k2;` }, ['async k.fixed']],
  ['control: a same-named key in another function changing does not touch this one', { 'src/probe.ts': `${AS} const k = 'k.outer'; disk.setItem(k, '1'); function g() { let k = 'z'; k = 'w'; return k; } void g;` }, ['async k.outer']],
  // the app's entry and what it loads outside src/
  ['entry: index.ts, App.tsx and a root file App.tsx loads', {
    'index.ts': "import App from './App'; void App;",
    'App.tsx': `${AS} import { boot } from './boot/start'; disk.getItem('k.app'); export default function App() { boot(); return null; }`,
    'boot/start.ts': `${AS} export function boot() { void disk.getItem('k.boot'); }`,
    'src/probe.ts': 'export const a = 1;',
  }, ['async k.app', 'async k.boot']],
];

describe('FR-910R2 the scan reads a saved key through every way in, or reports it', () => {
  it.each(rows)('%s', (_name, files, expected) => {
    expect(keysOf(scanTree(files))).toEqual(expected);
  });
});
