import * as path from 'path';
import type { Scan } from '../../test/savedKeyLifetimes/scanSavedKeys';

const ASYNC = "import disk from '@react-native-async-storage/async-storage';";
const MMKV = "import { prefsStorage } from './storage/mmkv';";
const SECURE = "import * as vault from 'expo-secure-store';";
const KEY = 'ls910.unregistered';

/**
 * Parser fixtures only: no runtime source is created or edited. A storage
 * spelling must either expose its key or produce an unresolved site/adapter
 * that the existing contract rejects. Silently returning nothing is unsafe.
 */
function fixtureScan(source: string, extra: Record<string, string> = {}): Scan {
  const root = process.cwd();
  const files: Record<string, string> = {
    'src/probe.ts': source,
    'src/storage/mmkv.ts': '',
    'src/services/secureStorage.ts': '',
    ...extra,
  };
  let result: Scan | undefined;
  jest.isolateModules(() => {
    const actual = jest.requireActual<typeof import('fs')>('fs');
    const rel = (value: unknown) => path.relative(root, String(value)).split(path.sep).join('/');
    jest.doMock('fs', () => ({
      ...actual,
      existsSync: (value: unknown) => {
        const name = rel(value);
        return name.startsWith('src/') ? Object.hasOwn(files, name) : actual.existsSync(String(value));
      },
      readFileSync: (value: unknown, ...args: unknown[]) => {
        const name = rel(value);
        if (Object.hasOwn(files, name)) return files[name];
        return (actual.readFileSync as (...a: unknown[]) => unknown)(value, ...args);
      },
      readdirSync: (value: unknown, options: unknown) => {
        const name = rel(value);
        if (name !== 'src' && !name.startsWith('src/')) {
          return (actual.readdirSync as (...a: unknown[]) => unknown)(value, options);
        }
        const prefix = `${name}/`;
        const names = [...new Set(Object.keys(files).filter((f) => f.startsWith(prefix))
          .map((f) => f.slice(prefix.length).split('/')[0]))];
        return names.map((entry) => ({
          name: entry,
          isDirectory: () => Object.keys(files).some((f) => f.startsWith(`${prefix}${entry}/`)),
        }));
      },
    }));
    const scanner = jest.requireActual<typeof import('../../test/savedKeyLifetimes/scanSavedKeys')>(
      '../../test/savedKeyLifetimes/scanSavedKeys',
    );
    result = scanner.scanSavedKeys();
    jest.dontMock('fs');
  });
  return result!;
}

describe('LS-910 B2 every storage spelling is found or rejected', () => {
  it.each([
    ['direct default alias', `${ASYNC} disk.setItem('${KEY}', '1');`, {}],
    ['constant key', `${ASYNC} const key = '${KEY}'; disk.setItem(key, '1');`, {}],
    ['object property key', `${ASYNC} const keys = { saved: '${KEY}' }; disk.setItem(keys.saved, '1');`, {}],
    ['computed key', `${ASYNC} const keys = { saved: '${KEY}' }; disk.setItem(keys['saved'], '1');`, {}],
    ['map key list', `${ASYNC} ['${KEY}'].map(k => disk.setItem(k, '1'));`, {}],
    ['local wrapper', `${ASYNC} function save(key: string) { return disk.setItem(key, '1'); } save('${KEY}');`, {}],
    ['mmkv direct', `${MMKV} prefsStorage.set('${KEY}', '1');`, {}],
    ['secure direct', `${SECURE} vault.setItemAsync('${KEY}', '1');`, {}],
    ['local store alias', `${ASYNC} const alias = disk; alias.setItem('${KEY}', '1');`, {}],
    ['mmkv local alias', `${MMKV} const alias = prefsStorage; alias.set('${KEY}', '1');`, {}],
    ['object-held store', `${ASYNC} const stores = { disk }; stores.disk.setItem('${KEY}', '1');`, {}],
    ['computed storage method', `${ASYNC} disk['setItem']('${KEY}', '1');`, {}],
    ['destructured storage method', `${ASYNC} const { setItem } = disk; setItem('${KEY}', '1');`, {}],
    ['named secure-store method', `import { setItemAsync } from 'expo-secure-store'; setItemAsync('${KEY}', '1');`, {}],
    ['bulk AsyncStorage save', `${ASYNC} disk.multiSet([['${KEY}', '1']]);`, {}],
    ['dynamic storage import', `async function save() { const { default: disk } = await import('@react-native-async-storage/async-storage'); await disk.setItem('${KEY}', '1'); }`, {}],
    ['barrel storage export', `import disk from './barrel'; disk.setItem('${KEY}', '1');`, {
      'src/barrel.ts': "export { default } from '@react-native-async-storage/async-storage';",
    }],
    ['re-exported key wrapper', `import { save } from './barrel'; save('${KEY}');`, {
      'src/barrel.ts': "export { save } from './wrapper';",
      'src/wrapper.ts': `${ASYNC} export function save(key: string) { return disk.setItem(key, '1'); }`,
    }],
  ] as Array<[string, string, Record<string, string>]>)('%s', (_name, source, extra) => {
    const result = fixtureScan(source, extra);
    expect(result.sites.length + result.adapters.length).toBeGreaterThan(0);
    if (result.sites.length > 0) {
      expect(result.sites.some((site) => site.key === KEY || site.key === '*')).toBe(true);
    }
  });
});
