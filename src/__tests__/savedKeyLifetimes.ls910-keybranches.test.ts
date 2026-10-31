import * as path from 'path';
import type { Scan } from '../../test/savedKeyLifetimes/scanSavedKeys';

const NEW_KEY = 'ls910.branch-unregistered';
const OLD_KEY = 'pending_invite_code';

/** One virtual source file; the real source tree is never edited. */
function scanKeyFunction(body: string): Scan {
  const root = process.cwd();
  const probe = path.join(root, 'src/probe.ts');
  const source = `
    import disk from '@react-native-async-storage/async-storage';
    function key(alternate: boolean) { ${body} }
    disk.setItem(key(Math.random() > 0.5), 'saved');
  `;
  let result: Scan | undefined;
  jest.isolateModules(() => {
    const actual = jest.requireActual<typeof import('fs')>('fs');
    jest.doMock('fs', () => ({
      ...actual,
      existsSync: (file: unknown) => String(file) === probe || actual.existsSync(String(file)),
      readFileSync: (file: unknown, ...args: unknown[]) =>
        String(file) === probe ? source : (actual.readFileSync as (...a: unknown[]) => unknown)(file, ...args),
      readdirSync: (file: unknown, ...args: unknown[]) =>
        String(file) === path.join(root, 'src')
          ? [{ name: 'probe.ts', isDirectory: () => false }]
          : (actual.readdirSync as (...a: unknown[]) => unknown)(file, ...args),
    }));
    result = require('../../test/savedKeyLifetimes/scanSavedKeys').scanSavedKeys();
  });
  jest.dontMock('fs');
  return result!;
}

describe('LS-910 B5 key functions do not discard reachable saved keys', () => {
  it.each([
    ['conditional expression control', `return alternate ? '${NEW_KEY}' : '${OLD_KEY}';`],
    ['if return before fallback', `if (alternate) return '${NEW_KEY}'; return '${OLD_KEY}';`],
    ['switch return before fallback', `switch (alternate) { case true: return '${NEW_KEY}'; } return '${OLD_KEY}';`],
  ])('%s', (_name, body) => {
    const result = scanKeyFunction(body);
    const foundOrRejected = result.adapters.length > 0 ||
      result.sites.some((site) => site.key === NEW_KEY || site.key === '*');
    expect(foundOrRejected).toBe(true);
  });
});
