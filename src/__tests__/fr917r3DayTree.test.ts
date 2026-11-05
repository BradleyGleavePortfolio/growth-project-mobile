// FR-917R3 (LS-917R3 B1, LO-917R3 C5): more syntax the day guard must see in
// the tree. Each child guard run sees one mutation in a private copy of src;
// the copy's file is restored after each case.
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
const guard = path.join(root, 'src/__tests__/workoutDayRule.test.ts');
// The guard reads a private copy of src (FR917_DAY_ROOT), so the product tree
// is never edited and other tests' guard runs never see these mutations.
const copy = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fr917r3-day-'));
fs.cpSync(path.join(root, 'src'), path.join(copy, 'src'), { recursive: true });
afterAll(() => fs.rmSync(copy, { recursive: true, force: true }));
const listed = path.join(copy, 'src/utils/workout/workoutDoneToday.ts');
const placedLine = path.join(copy, 'src/screens/client/progress/progressV2.ts');

function runGuard() {
  const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', '--forceExit', '--runTestsByPath', guard], {
    cwd: root, encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, FR917_DAY_ROOT: copy },
  });
  if (result.error) throw result.error;
  return result;
}

// Each mutation passed the line-text guard at bce72a71 (red there).
const cases: Array<[name: string, file: string, body: string]> = [
  ['a raw parse split over two lines with a rule call on the second', listed, `export const fr3a = (row: WorkoutRowLike) => new Date(
    String(row.date)).getDay() === 1 && !!workoutDay(row);`],
  ['a computed destructured field', listed, `export const fr3b = ({ ['date']: d }: WorkoutRowLike) => new Date(String(d)).getDay();`],
  ['a stored day parsed inside a template beside a rule call', listed, 'export const fr3c = (row: WorkoutRowLike) => [workoutDay(row), new Date(`${row.date}T00:00:00`).getDay()];'],
  ['a raw parse on a line that also holds a placed snippet', placedLine, `export const fr3d = (log: { date: string }) => [dayX(log.date), Date.parse(String(log.date))];`],
];

it.each(cases)('the guard rejects %s', (_name, file, body) => {
  const original = fs.readFileSync(file, 'utf8');
  try {
    fs.writeFileSync(file, `${original}\n${body}\n`);
    const result = runGuard();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path.basename(file));
  } finally {
    fs.writeFileSync(file, original);
  }
}, 45_000);
