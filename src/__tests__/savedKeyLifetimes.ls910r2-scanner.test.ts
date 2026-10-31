import * as path from 'path';
import type { Scan } from '../../test/savedKeyLifetimes/scanSavedKeys';

const KEY = 'ls910r2.unregistered';
const AS = "import disk from '@react-native-async-storage/async-storage';";

/** Parser-only files: the production tree is not edited. */
function scanFixture(source: string, extra: Record<string, string> = {}): Scan {
  const root = process.cwd();
  const files: Record<string, string> = { 'src/probe.ts': source, ...extra };
  let result: Scan | undefined;
  jest.isolateModules(() => {
    const actual = jest.requireActual<typeof import('fs')>('fs');
    const rel = (value: unknown) => path.relative(root, String(value)).split(path.sep).join('/');
    jest.doMock('fs', () => ({
      ...actual,
      existsSync: (value: unknown) => {
        const file = rel(value);
        return file.startsWith('src/') ? Object.hasOwn(files, file) : actual.existsSync(String(value));
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

describe('LS-910R2 B1 storage discovery stays closed through supported provenance', () => {
  it.each([
    ['direct control', `${AS} disk.setItem('${KEY}', '1');`, {}],
    ['new wrapper control', `${AS} function save(k: string) { return disk.setItem(k, '1'); } save('${KEY}');`, {}],
    ['computed key control', `${AS} disk.setItem(runtimeKey(), '1');`, {}],
    ['inline require', `require('@react-native-async-storage/async-storage').default.setItem('${KEY}', '1');`, {}],
    ['inline import', `async function save() { (await import('@react-native-async-storage/async-storage')).default.setItem('${KEY}', '1'); }`, {}],
    ['computed namespace wrapper', `import * as writes from './writer'; writes['save']('${KEY}');`, {
      'src/writer.ts': `${AS} export function save(k: string) { return disk.setItem(k, '1'); }`,
    }],
    ['namespace wrapper through barrel', `import * as writes from './barrel'; writes.save('${KEY}');`, {
      'src/barrel.ts': "export { save } from './writer';",
      'src/writer.ts': `${AS} export function save(k: string) { return disk.setItem(k, '1'); }`,
    }],
    ['reassigned key', `${AS} let key = 'pending_invite_code'; if (Math.random() > 0.5) key = '${KEY}'; disk.setItem(key, '1');`, {}],
  ] as Array<[string, string, Record<string, string>]>)('%s', (_name, source, extra) => {
    const result = scanFixture(source, extra);
    expect(result.adapters.length > 0 || result.sites.some((s) => s.key === KEY || s.key === '*')).toBe(true);
  });
});
