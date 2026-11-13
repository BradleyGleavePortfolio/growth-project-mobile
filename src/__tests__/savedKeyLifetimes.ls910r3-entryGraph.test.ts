/**
 * B-TEST LS-910R3 B2: reaching src/ must not terminate the entry import graph. A source file may load
 * app-owned code outside src/, and its storage must still be scanned (or explicitly rejected).
 */
import { fixtureScan, foundOrRejected } from '../../test/savedKeyLifetimes/ls910r3Fixture';

const KEY = 'ls910r3.entry-unregistered';
const save = `import disk from '@react-native-async-storage/async-storage'; disk.setItem('${KEY}', '1');`;
type Form = [string, Record<string, string>, string];
const forms: Form[] = [
  ['control: root loads root directly', {
    'index.ts': "import './App';",
    'App.tsx': "import './boot/start';",
    'boot/start.ts': save,
  }, 'boot/start.ts'],
  ['control: src storage itself is scanned', {
    'index.ts': "import './App';",
    'App.tsx': "import './src/start';",
    'src/start.ts': save,
  }, 'src/start.ts'],
  ['root loads src which loads root', {
    'index.ts': "import './App';",
    'App.tsx': "import './src/start';",
    'src/start.ts': "import '../boot/start';",
    'boot/start.ts': save,
  }, 'boot/start.ts'],
  ['entry itself lives in src and loads root', {
    'package.json': JSON.stringify({ main: 'src/start.ts' }),
    'src/start.ts': "import '../boot/start';",
    'boot/start.ts': save,
  }, 'boot/start.ts'],
  ['src lazily loads root app code', {
    'index.ts': "import './src/start';",
    'src/start.ts': "export async function f() { await import('../boot/start'); }",
    'boot/start.ts': save,
  }, 'boot/start.ts'],
];

describe('B-TEST LS-910R3 B2 complete entry graph stays in scope', () => {
  it.each(forms)('%s', (_name, files, at) => {
    const scan = fixtureScan(files);
    expect({
      reported: foundOrRejected(scan, at, KEY),
      sites: scan.sites,
      adapters: scan.adapters,
    }).toEqual(expect.objectContaining({ reported: true }));
  });
});
