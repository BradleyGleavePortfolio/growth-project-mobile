/**
 * B-TEST (lens LO-910, m#910 review round 1): the saved-key scan must fail closed. Each case below adds one
 * small file under src/ (in memory only: fs is overlaid for the scan, nothing is written to disk) that saves
 * the key 'lo910.<form>' in one ordinary TypeScript form. The scan passes the form only if it reports a site
 * for that file (its key read, or '*' so case 1 goes red) or names the file as an adapter (case 3 goes red).
 * A form it neither reads nor reports lets a new, unregistered saved key pass case 1 green.
 */
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIR = 'src/lo910forms';
const AS = "import AsyncStorage from '@react-native-async-storage/async-storage';";

type Form = { name: string; files: Record<string, string>; at: string };
const FORMS: Form[] = [
  { name: 'control: a direct call with a literal key', at: 'control.ts',
    files: { 'control.ts': `${AS}\nexport async function f() { await AsyncStorage.setItem('lo910.control', '1'); }` } },
  { name: 'control: a wrapper called from another file', at: 'wrapUse.ts',
    files: {
      'wrap.ts': `${AS}\nexport async function saveFlag(key: string) { await AsyncStorage.setItem(key, '1'); }`,
      'wrapUse.ts': "import { saveFlag } from './wrap';\nexport const g = () => saveFlag('lo910.wrapper');",
    } },
  { name: 'control: a key built at run time (reported as *)', at: 'computed.ts',
    files: { 'computed.ts': `${AS}\nexport const g = (p: string) => AsyncStorage.setItem(['lo910', p].join('.'), '1');` } },
  { name: 'control: a store call inside an object method (reported as an adapter)', at: 'objMethod.ts',
    files: { 'objMethod.ts': `${AS}\nexport const kv = { save(k: string) { return AsyncStorage.setItem(k, '1'); } };` } },
  { name: 'a wrapper re-exported through an index file', at: 'barrelUse.ts',
    files: {
      'barrelWrap.ts': `${AS}\nexport async function saveViaBarrel(key: string) { await AsyncStorage.setItem(key, '1'); }`,
      'index.ts': "export { saveViaBarrel } from './barrelWrap';",
      'barrelUse.ts': "import { saveViaBarrel } from '.';\nexport const g = () => saveViaBarrel('lo910.barrel');",
    } },
  { name: 'a default-exported wrapper imported under another name', at: 'defaultUse.ts',
    files: {
      'defaultWrap.ts': `${AS}\nexport default async function saveDefault(key: string) { await AsyncStorage.setItem(key, '1'); }`,
      'defaultUse.ts': "import save from './defaultWrap';\nexport const g = () => save('lo910.default');",
    } },
  { name: 'the store reached under another name (an alias)', at: 'alias.ts',
    files: { 'alias.ts': `${AS}\nconst store = AsyncStorage;\nexport const g = () => store.setItem('lo910.alias', '1');` } },
  { name: 'the store handed in as a parameter', at: 'param.ts',
    files: { 'param.ts': `${AS}\nfunction writeTo(s: typeof AsyncStorage) { return s.setItem('lo910.param', '1'); }\nexport const g = () => writeTo(AsyncStorage);` } },
  { name: 'a dynamic import of AsyncStorage', at: 'dynamic.ts',
    files: { 'dynamic.ts': "export async function g() {\n  const { default: S } = await import('@react-native-async-storage/async-storage');\n  await S.setItem('lo910.dynamic', '1');\n}" } },
  { name: 'require() of AsyncStorage', at: 'required.ts',
    files: { 'required.ts': "export function g() {\n  const S = require('@react-native-async-storage/async-storage').default;\n  return S.setItem('lo910.require', '1');\n}" } },
  { name: 'a named import from expo-secure-store', at: 'secureNamed.ts',
    files: { 'secureNamed.ts': "import { setItemAsync } from 'expo-secure-store';\nexport const g = () => setItemAsync('lo910.secureNamed', '1');" } },
  { name: "AsyncStorage's own useAsyncStorage hook", at: 'hook.ts',
    files: { 'hook.ts': "import { useAsyncStorage } from '@react-native-async-storage/async-storage';\nexport function useG() { const s = useAsyncStorage('lo910.hook'); return () => s.setItem('1'); }" } },
  { name: 'AsyncStorage.multiSet', at: 'multi.ts',
    files: { 'multi.ts': `${AS}\nexport const g = () => AsyncStorage.multiSet([['lo910.multiSet', '1']]);` } },
  { name: 'a wrapper handed to forEach as a callback', at: 'cbUse.ts',
    files: {
      'cbWrap.ts': `${AS}\nexport async function saveCb(key: string) { await AsyncStorage.setItem(key, '1'); }`,
      'cbUse.ts': "import { saveCb } from './cbWrap';\nexport const g = () => ['lo910.callback'].forEach(saveCb);",
    } },
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
        return String(p) === path.join(ROOT, 'src') ? [...list, dirent('lo910forms', true)] : list;
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = require('../../test/savedKeyLifetimes/scanSavedKeys').scanSavedKeys();
  });
  return out!;
}

describe('B-TEST LO-910: the saved-key scan fails closed on every form it cannot read', () => {
  it.each(FORMS.map((f) => [f.name, f] as const))('%s', (_name, form) => {
    const scan = scanWith(form.files);
    const file = `${DIR}/${form.at}`;
    const sites = scan.sites.filter((s) => s.file === file);
    const reported = sites.some((s) => s.key.startsWith('lo910.') || s.key.includes('*')) ||
      scan.adapters.some((a) => a.startsWith(`${file}:`));
    expect({ file, reported, sites }).toEqual(expect.objectContaining({ reported: true }));
  });
});
