/**
 * FR-910R3 own tests (fix round 3, agent 192): one more form for each round-3 class, red at 9e316b34 (the round-3
 * B-TESTs on d98074df) and green at the fix. Every form overlays files in memory only (fs is overlaid for the scan;
 * nothing is written to disk). A form passes if the scan reports a site in one of its files other than the wrapper's
 * own (its key, or '*' so case 1 goes red), or an adapter there (case 3 goes red).
 *   - F1: a module's `.then` chain two deep; a wrapper namespace spread into an object that is then passed on.
 *   - F2: a root file reached from a nested src/ file by a lazy require().
 *   - F3: a key list pushed through an alias in a third file.
 *   - F4: a keyed row's key with a part after the account id is not taken as the row.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { fixtureScan } from '../../test/savedKeyLifetimes/ls910r3Fixture';
import { REGISTRY } from '../../test/savedKeyLifetimes/savedKeyRegistry';
import type { KeySite, Scan } from '../../test/savedKeyLifetimes/scanSavedKeys';

const KEY = 'fr910r3.unregistered';
const AS = "import disk from '@react-native-async-storage/async-storage';";
const writer = `${AS} export function save(key: string) { return disk.setItem(key, '1'); }`;

/** Reported anywhere but the wrapper's own file. */
function reported(scan: Scan): boolean {
  const mine = (f: string) => f !== 'src/writer.ts';
  return scan.sites.some((s) => mine(s.file) && (s.key === KEY || s.key.includes('*'))) ||
    scan.adapters.some((a) => mine(a.split(':')[0]));
}

const FORMS: Array<{ name: string; files: Record<string, string> }> = [
  { name: 'control: awaited wrapper namespace', files: {
    'src/writer.ts': writer,
    'src/probe.ts': `export async function f() { const m = await import('./writer'); await m.save('${KEY}'); }`,
  } },
  { name: 'control: root file loaded from the root', files: {
    'index.ts': "import './tools/save';",
    'tools/save.ts': `${AS} disk.setItem('${KEY}', '1');`,
  } },
  { name: 'F1 wrapper module, .then chain two deep', files: {
    'src/writer.ts': writer,
    'src/probe.ts': `import('./writer').then((m) => m).then((m) => m.save('${KEY}'));`,
  } },
  { name: 'F1 storage module, .then chain two deep', files: {
    'src/probe.ts': `import('@react-native-async-storage/async-storage')
      .then((m) => m.default).then((store) => store.setItem('${KEY}', '1'));`,
  } },
  { name: 'F1 wrapper namespace spread into an object, then passed on', files: {
    'src/writer.ts': writer,
    'src/barrel.ts': "import * as w from './writer'; export const api = { ...w };",
    'src/probe.ts': `import { api } from './barrel';
      const run = (x: typeof api) => x.save('${KEY}'); export function f() { return run(api); }`,
  } },
  { name: 'F2 root file reached from a nested src file by a lazy require', files: {
    'src/probe.ts': "import './deep/start';",
    'src/deep/start.ts': "export function f() { return require('../../tools/save'); }",
    'tools/save.ts': `${AS} disk.setItem('${KEY}', '1');`,
  } },
  { name: 'F3 key list pushed through an alias in a third file', files: {
    'src/keys.ts': "export const KEYS = ['pending_invite_code'];",
    'src/third.ts': `import { KEYS } from './keys'; export function add() { const list = KEYS; list.push('${KEY}'); }`,
    'src/probe.ts': `${AS} import { KEYS } from './keys'; export function f() { return disk.multiGet(KEYS); }`,
  } },
];

describe('FR-910R3 own forms stay fail closed', () => {
  it.each(FORMS)('$name', ({ files }) => {
    const scan = fixtureScan(files);
    expect({ reported: reported(scan), sites: scan.sites, adapters: scan.adapters })
      .toEqual(expect.objectContaining({ reported: true }));
  });
});

/** The contract's own row match, compiled from its source lines (as the LO-910R3 B2 B-TEST reads it). */
function contractRowOf(): (site: KeySite) => unknown {
  const src = fs.readFileSync(path.resolve(__dirname, 'savedKeyLifetimes.test.ts'), 'utf8');
  const pick = (name: string) => {
    const m = new RegExp(`^const ${name} = [\\s\\S]*?;$`, 'm').exec(src);
    if (!m) throw new Error(`savedKeyLifetimes.test.ts has no ${name}`);
    return m[0];
  };
  const body = ['glob', 'exact', 'globRows', 'rowOf'].map(pick).join('\n');
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('REGISTRY', `${js}\nreturn rowOf;`)(REGISTRY) as (site: KeySite) => unknown;
}

it('F4 a keyed row\'s key with a part after the account id is not taken as the row', () => {
  const scan = fixtureScan({
    'src/probe.ts': `${AS} export function f(uid: string) { return disk.setItem(\`macro_targets:\${uid}:draft\`, '{}'); }`,
  });
  const sites = scan.sites.filter((s) => s.file === 'src/probe.ts');
  expect(sites.map((s) => s.key)).toEqual(['macro_targets:*:draft']);
  const rowOf = contractRowOf();
  expect(sites.filter((s) => rowOf(s)).map((s) => s.key)).toEqual([]);
  // control: the row's own key still matches it
  expect(rowOf({ ...sites[0], key: 'macro_targets:*' })).toBeTruthy();
});
