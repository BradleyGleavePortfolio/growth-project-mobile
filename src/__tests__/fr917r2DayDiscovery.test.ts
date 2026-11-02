// FR-917R2 (LS-917R2 B1, LO-917R2 C9): the real guard is run once with three
// added day readers. Each must be named in the guard's failure output, so a
// failure for any other reason does not count. FR-917R3B: the readers are
// written into a private copy of src (FR917_DAY_ROOT), so this suite never
// edits the product tree that other guard runs read at the same time.
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
const guard = path.join(root, 'src/__tests__/workoutDayRule.test.ts');
const copy = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fr917r2-day-'));
fs.cpSync(path.join(root, 'src'), path.join(copy, 'src'), { recursive: true });
afterAll(() => fs.rmSync(copy, { recursive: true, force: true }));
const listed = path.join(copy, 'src/utils/workout/workoutDoneToday.ts');
// Not in the workout class by import or field name: its own row type only.
const fresh = path.join(copy, 'src/screens/client/fr917DayProbeOwnRow.ts');

const listedReaders = `
export const fr917r2InstantProbe = (w: { date: string }) => instantDay(w.date);
export const fr917r2ParseProbe = (w: { date: string }) =>
  new Date(Date.parse(w.date)).getDay();
`;
const ownRowReader = `export const fr917r2OwnRowProbe = (w: { date: string }) => new Date(w.date).toLocaleDateString();
`;

it('a reader added to a listed file, of either kind, and a new file with its own row type all fail the guard', () => {
  if (fs.existsSync(fresh)) throw new Error('Refusing to replace an existing probe');
  const original = fs.readFileSync(listed, 'utf8');
  try {
    fs.writeFileSync(listed, original + listedReaders);
    fs.writeFileSync(fresh, ownRowReader);
    const result = spawnSync(process.execPath, [
      require.resolve('jest/bin/jest'), '--runInBand', '--forceExit', '--runTestsByPath', guard,
    ], {
      cwd: root, encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, FR917_DAY_PROBE: '1', FR917_DAY_ROOT: copy },
    });
    if (result.error) throw result.error;
    expect(result.status).toBe(1);
    // instantDay(w.date): a stored calendar date read as an instant.
    expect(result.stderr).toContain('a stored calendar date read as an instant');
    // Date.parse(w.date) in a listed file: reported line by line.
    expect(result.stderr).toContain('new Date(Date.parse(w.date)).getDay()');
    // A new file outside the class by import, with its own row type.
    expect(result.stderr).toContain('fr917DayProbeOwnRow.ts');
  } finally {
    fs.writeFileSync(listed, original);
    fs.rmSync(fresh, { force: true });
  }
}, 45_000);
