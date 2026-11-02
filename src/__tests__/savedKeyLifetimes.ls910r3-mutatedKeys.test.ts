/**
 * B-TEST LS-910R3 B3: a saved-key container is still mutable through an alias or an array method.
 * Keeping only its registered initializer silently blesses a different, unregistered key at runtime.
 */
import { fixtureScan, foundOrRejected } from '../../test/savedKeyLifetimes/ls910r3Fixture';

const KEY = 'ls910r3.mutated-unregistered';
const AS = "import disk from '@react-native-async-storage/async-storage';";
const OLD = 'pending_invite_code';
type Form = [string, string];
const forms: Form[] = [
  ['control: direct reassignment', `let key = '${OLD}'; key = '${KEY}'; disk.setItem(key, '1');`],
  ['control: direct property assignment', `const keys = { a: '${OLD}' }; keys.a = '${KEY}'; disk.setItem(keys.a, '1');`],
  ['control: direct list push', `const keys = ['${OLD}']; keys.push('${KEY}'); disk.multiGet(keys);`],
  ['property mutation through alias', `const keys = { a: '${OLD}' }; const alias = keys;
    alias.a = '${KEY}'; disk.setItem(keys.a, '1');`],
  ['property mutation through Object.assign', `const keys = { a: '${OLD}' };
    Object.assign(keys, { a: '${KEY}' }); disk.setItem(keys.a, '1');`],
  ['list push through alias', `const keys = ['${OLD}']; const alias = keys;
    alias.push('${KEY}'); disk.multiGet(keys);`],
  ['list splice', `const keys = ['${OLD}']; keys.splice(0, 1, '${KEY}'); disk.multiGet(keys);`],
  ['list fill', `const keys = ['${OLD}']; keys.fill('${KEY}'); disk.multiGet(keys);`],
];

describe('B-TEST LS-910R3 B3 changed key containers stay fail closed', () => {
  it.each(forms)('%s', (_name, source) => {
    const scan = fixtureScan({ 'src/probe.ts': `${AS} ${source}` });
    expect({
      reported: foundOrRejected(scan, 'src/probe.ts', KEY),
      sites: scan.sites,
      adapters: scan.adapters,
    }).toEqual(expect.objectContaining({ reported: true }));
  });
});
