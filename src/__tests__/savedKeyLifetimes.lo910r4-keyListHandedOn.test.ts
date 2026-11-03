/**
 * B-TEST (lens LO-910R4, m#910 review round 4, B2): F3, a key container handed on, aliased or written by an importer
 * is followed or read as '*' (fail closed). FR-910R3 follows a key list written through a named import (in the
 * importer or a third file). Two holes remain, and in both the scan reads the list at its first, registered value:
 * (1) importers it does not index: a default export (the app default-exports its constant objects,
 * src/theme/tokens.ts:641, src/constants/colors.ts:112), a default re-exported by name through a barrel (the app's
 * barrels do this, src/components/community/index.ts:6), a list loaded by an awaited import(), a list destructured
 * from a namespace import; (2) a list handed on in a way the scan reads as unchanged: kept in an object, returned by
 * a getter, passed to an app object's method or to an app class (the app keeps storage in classes,
 * src/storage/mmkv.ts:152).
 * Each form adds files under src/ in memory only (fixtureScan overlays fs). A form passes if the scan reports the
 * new key or '*' anywhere (case 1 goes red), or reports a use as unsupported (case 3 goes red). At d7e6bbb7 every
 * form gives one site, src/probe.ts multiGet 'pending_invite_code', and nothing else: the key really saved has no row.
 */
import { fixtureScan } from '../../test/savedKeyLifetimes/ls910r3Fixture';

const KEY = 'lo910r4.unregistered';
const AS = "import disk from '@react-native-async-storage/async-storage';\n";
const READ = (from: string, name = '{ KEYS }') =>
  `${AS}import ${name} from '${from}';\nexport function f() { return disk.multiGet(${name.replace(/[{} ]/g, '')}); }\n`;
const NAMED = "export const KEYS = ['pending_invite_code'];\n";

function reported(files: Record<string, string>): boolean {
  const scan = fixtureScan(files);
  return scan.sites.some((s) => s.key === KEY || s.key.includes('*')) || scan.adapters.length > 0;
}

const FORMS: Record<string, Record<string, string>> = {
  'a default-exported list pushed by an importer': {
    'src/keys.ts': "const KEYS = ['pending_invite_code'];\nexport default KEYS;\n",
    'src/third.ts': `import KEYS from './keys';\nexport function add() { KEYS.push('${KEY}'); }\n`,
    'src/probe.ts': READ('./keys', 'KEYS'),
  },
  'a default re-exported by name through a barrel, pushed by an importer': {
    'src/keys.ts': "const KEYS = ['pending_invite_code'];\nexport default KEYS;\n",
    'src/barrel.ts': "export { default as KEYS } from './keys';\n",
    'src/third.ts': `import { KEYS } from './barrel';\nexport function add() { KEYS.push('${KEY}'); }\n`,
    'src/probe.ts': READ('./barrel'),
  },
  'a list loaded by an awaited import() and pushed': {
    'src/keys.ts': NAMED,
    'src/third.ts': `export async function add() { const { KEYS } = await import('./keys'); KEYS.push('${KEY}'); }\n`,
    'src/probe.ts': READ('./keys'),
  },
  'a list destructured from a namespace import and pushed': {
    'src/keys.ts': NAMED,
    'src/third.ts':
      `import * as K from './keys';\nconst { KEYS } = K;\nexport function add() { KEYS.push('${KEY}'); }\n`,
    'src/probe.ts': READ('./keys'),
  },
  'a list kept in an object and pushed through it': {
    'src/keys.ts': `${NAMED}const GROUPS = { all: KEYS };\nGROUPS.all.push('${KEY}');\n`,
    'src/probe.ts': READ('./keys'),
  },
  'a list returned by a getter and pushed by its caller': {
    'src/keys.ts': `${NAMED}export function allKeys() { return KEYS; }\n`,
    'src/third.ts': `import { allKeys } from './keys';\nexport function add() { allKeys().push('${KEY}'); }\n`,
    'src/probe.ts': READ('./keys'),
  },
  "a list passed to an app object's method that pushes": {
    'src/keys.ts':
      `${NAMED}const lists = { add(list: string[], k: string) { list.push(k); } };\nlists.add(KEYS, '${KEY}');\n`,
    'src/probe.ts': READ('./keys'),
  },
  'a list passed to an app class that pushes': {
    'src/keys.ts':
      `${NAMED}class Bag {\n  constructor(private list: string[]) {}\n  add(k: string) { this.list.push(k); }\n}\n` +
      `new Bag(KEYS).add('${KEY}');\n`,
    'src/probe.ts': READ('./keys'),
  },
};

it('control: a list pushed through a named import in a third file is reported', () => {
  expect(reported({
    'src/keys.ts': NAMED,
    'src/third.ts': `import { KEYS } from './keys';\nexport function add() { KEYS.push('${KEY}'); }\n`,
    'src/probe.ts': READ('./keys'),
  })).toBe(true);
});

it('control: a list nobody changes gives its registered key and nothing else', () => {
  expect(reported({ 'src/keys.ts': NAMED, 'src/probe.ts': READ('./keys') })).toBe(false);
});

it('B-TEST LO-910R4 B2: a key list handed on, aliased or written by an importer is followed or read as *', () => {
  const unreported = Object.entries(FORMS).filter(([, files]) => !reported(files)).map(([name]) => name);
  expect(unreported).toEqual([]);
});
