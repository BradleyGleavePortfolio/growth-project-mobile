import * as path from 'path';
import type { Scan } from './scanSavedKeys';

/** Entire app source overlaid in memory. No reviewed source or storage behavior is changed. */
export function fixtureScan(extra: Record<string, string>): Scan {
  const root = process.cwd();
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ main: 'index.ts' }),
    'index.ts': "import './src/probe';",
    'src/probe.ts': '',
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
        return !name.startsWith('../') && !path.isAbsolute(name)
          ? Object.hasOwn(files, name)
          : actual.existsSync(String(value));
      },
      readFileSync: (value: unknown, ...args: unknown[]) => {
        const name = rel(value);
        return Object.hasOwn(files, name)
          ? files[name]
          : (actual.readFileSync as (...a: unknown[]) => unknown)(value, ...args);
      },
      readdirSync: (value: unknown, options: unknown) => {
        const name = rel(value);
        if (name !== 'src' && !name.startsWith('src/')) {
          return (actual.readdirSync as (...a: unknown[]) => unknown)(value, options);
        }
        const prefix = `${name}/`;
        return [...new Set(Object.keys(files).filter((f) => f.startsWith(prefix))
          .map((f) => f.slice(prefix.length).split('/')[0]))].map((entry) => ({
          name: entry,
          isDirectory: () => Object.keys(files).some((f) => f.startsWith(`${prefix}${entry}/`)),
        }));
      },
    }));
    result = jest.requireActual<typeof import('./scanSavedKeys')>('./scanSavedKeys').scanSavedKeys();
  });
  jest.dontMock('fs');
  return result!;
}

export function foundOrRejected(scan: Scan, file: string, key: string): boolean {
  return scan.sites.some((site) => site.file === file && (site.key === key || site.key.includes('*'))) ||
    scan.adapters.some((adapter) => adapter.startsWith(`${file}:`));
}
