// LS-917: mutation-test the real inventory guard. The temporary product file
// is created only inside the test process and always removed in finally.
// FLAKY-PAIR-M: it is written into a private copy of src (FR917_DAY_ROOT),
// never the shared tree, so the suite's own guard run and every suite that
// walks src at the same time never see it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ls917-day-'));
fs.cpSync(path.join(root, 'src'), path.join(copy, 'src'), { recursive: true });
afterAll(() => fs.rmSync(copy, { recursive: true, force: true }));
const fixture = path.join(copy, 'src/utils/workout/ls917InventoryProbe.ts');
const guard = path.join(root, 'src/__tests__/workoutDayRule.test.ts');

function runWith(source: string) {
  if (fs.existsSync(fixture)) throw new Error('LS-917 probe refuses to replace an existing file');
  try {
    fs.writeFileSync(fixture, source);
    const result = spawnSync(process.execPath, [
      require.resolve('jest/bin/jest'),
      '--runInBand', '--forceExit', '--runTestsByPath', guard,
    ], {
      cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 40_000,
      env: { ...process.env, FR917_DAY_ROOT: copy },
    });
    if (result.error) throw result.error;
    return result;
  } finally {
    fs.rmSync(fixture, { force: true });
  }
}

it('control: the real day inventory guard rejects a new assignment-day reader', () => {
  const result = runWith('export const day = (row: { scheduled_for: string }) => row.scheduled_for.slice(0, 10);');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('ls917InventoryProbe.ts');
}, 45_000);

it('LS-917 B3: the real day inventory guard rejects a new workout-date reader that skips the rule', () => {
  const result = runWith(`
    import type { ApiWorkoutSession } from '../../hooks/useApi';
    export const countWorkouts = (rows: ApiWorkoutSession[], day: string) =>
      rows.filter((row) => row.date?.slice(0, 10) === day).length;
  `);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('ls917InventoryProbe.ts');
}, 45_000);
