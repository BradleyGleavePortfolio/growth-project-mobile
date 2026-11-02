/**
 * B-TEST LS-910R3 B1: a module that saves a new key must not disappear when loaded through a promise or
 * a namespace re-export. Finding the key or explicitly rejecting the form is acceptable; zero sites is not.
 * The controls exercise the same storage module and wrapper with the currently supported await syntax.
 */
import { fixtureScan, foundOrRejected } from '../../test/savedKeyLifetimes/ls910r3Fixture';

const KEY = 'ls910r3.unregistered';
const AS = "import disk from '@react-native-async-storage/async-storage';";
const writer = `${AS} export function save(key: string) { return disk.setItem(key, '1'); }`;
type Form = [string, string, Record<string, string>?];
const forms: Form[] = [
  ['control: direct storage', `${AS} disk.setItem('${KEY}', '1');`],
  ['control: awaited storage', `async function f() {
    const { default: disk } = await import('@react-native-async-storage/async-storage');
    await disk.setItem('${KEY}', '1');
  }`],
  ['control: awaited wrapper', `async function f() {
    const { save } = await import('./writer'); await save('${KEY}');
  }`, { 'src/writer.ts': writer }],
  ['storage import promise, destructured', `import('@react-native-async-storage/async-storage')
    .then(({ default: disk }) => disk.setItem('${KEY}', '1'));`],
  ['storage import promise, namespace', `import('@react-native-async-storage/async-storage')
    .then(ns => ns.default.setItem('${KEY}', '1'));`],
  ['wrapper import promise, destructured', `import('./writer')
    .then(({ save }) => save('${KEY}'));`, { 'src/writer.ts': writer }],
  ['wrapper import promise, namespace', `import('./writer')
    .then(writes => writes.save('${KEY}'));`, { 'src/writer.ts': writer }],
  ['namespace re-export of wrapper', `import { writes } from './barrel'; writes.save('${KEY}');`, {
    'src/writer.ts': writer,
    'src/barrel.ts': "export * as writes from './writer';",
  }],
  ['nested namespace re-export of wrapper', `import * as api from './barrel'; api.writes.save('${KEY}');`, {
    'src/writer.ts': writer,
    'src/barrel.ts': "export * as writes from './writer';",
  }],
];

describe('B-TEST LS-910R3 B1 module provenance stays fail closed', () => {
  it.each(forms)('%s', (_name, source, extra) => {
    const scan = fixtureScan({ 'src/probe.ts': source, ...extra });
    expect({
      reported: foundOrRejected(scan, 'src/probe.ts', KEY),
      sites: scan.sites,
      adapters: scan.adapters,
    }).toEqual(expect.objectContaining({ reported: true }));
  });
});
