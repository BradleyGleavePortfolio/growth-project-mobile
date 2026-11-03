/**
 * B-TEST (lens LO-910R4, m#910 review round 4, B1): F1, a nested namespace barrel (`export * as writes from
 * './writer'`, the wrapper `save(key)` saving its parameter). FR-910R3 follows the member chain `api.writes.save(key)`
 * and reports a two-level destructure of an awaited import() as unsupported. A nested namespace taken out by a
 * destructure is dropped: no site and no report, so the key saved has no row and every case stays green. The forms:
 * from an awaited import() (the app destructures awaited imports, src/screens/onboarding/OnboardingResults.tsx:52), in
 * a .then parameter (one or two levels), and from a static namespace import. Each form adds files under src/ in
 * memory only (fixtureScan overlays fs; nothing is written to disk). A form passes if the scan reports a site in the
 * using file with the key, or '*' (case 1 goes red), or reports the use there as unsupported (case 3 goes red).
 * At d7e6bbb7 every form gives no site and no report outside the wrapper.
 */
import { fixtureScan, foundOrRejected } from '../../test/savedKeyLifetimes/ls910r3Fixture';

const KEY = 'lo910r4.unregistered';
const USE = 'src/probe.ts';
const WRAPPER = {
  'src/writer.ts':
    "import disk from '@react-native-async-storage/async-storage';\n" +
    "export function save(key: string) { return disk.setItem(key, '1'); }\n",
  'src/barrel.ts': "export * as writes from './writer';\n",
};
const reported = (use: string) => foundOrRejected(fixtureScan({ ...WRAPPER, [USE]: use }), USE, KEY);

const FORMS: Record<string, string> = {
  'awaited import(), the nested namespace destructured':
    `export async function f() { const { writes } = await import('./barrel'); await writes.save('${KEY}'); }\n`,
  '.then parameter, the nested namespace destructured':
    `export function f() { return import('./barrel').then(({ writes }) => writes.save('${KEY}')); }\n`,
  '.then parameter, destructured two levels':
    `export function f() { return import('./barrel').then(({ writes: { save } }) => save('${KEY}')); }\n`,
  'static namespace import, the nested namespace destructured':
    "import * as api from './barrel';\nconst { writes } = api;\n" +
    `export function f() { return writes.save('${KEY}'); }\n`,
};

it('control: the nested namespace through a member chain is reported', () => {
  expect(reported(`import * as api from './barrel';\nexport function f() { return api.writes.save('${KEY}'); }\n`))
    .toBe(true);
});

it('B-TEST LO-910R4 B1: a nested namespace taken out by a destructure is followed or reported as unsupported', () => {
  const unreported = Object.entries(FORMS).filter(([, use]) => !reported(use)).map(([name]) => name);
  expect(unreported).toEqual([]);
});
