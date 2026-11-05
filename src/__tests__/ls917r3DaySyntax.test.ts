// Independent class-discovery mutations. Each child sees one mutation only.
// Product files are restored before the next case; this branch is tests only.
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
const listed = path.join(root, 'src/utils/workout/workoutDoneToday.ts');
const fresh = path.join(root, 'src/utils/workout/fr917DayProbeLSR3.ts');
const guard = path.join(root, 'src/__tests__/workoutDayRule.test.ts');

function runGuard() {
  const result = spawnSync(process.execPath, [
    require.resolve('jest/bin/jest'), '--runInBand', '--forceExit',
    '--runTestsByPath', guard,
  ], {
    cwd: root, encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, FR917_DAY_PROBE: '1' },
  });
  if (result.error) throw result.error;
  return result;
}

const mutations = [
  ['bracket field read', `export const lsR3 = (row: WorkoutRowLike) => new Date(row['date']!).getDay();`],
  ['destructured field read', `export const lsR3 = (row: WorkoutRowLike) => {
    const { date } = row;
    return new Date(date!).getDay();
  };`],
  ['optional bracket field read', `export const lsR3 = (row: WorkoutRowLike) => new Date(row?.['date']!).getDay();`],
  ['raw read beside a valid rule call', `export const lsR3 = (row: WorkoutRowLike) => [workoutDay(row), new Date(String(row.date)).getDay()];`],
] as const;

it('control: the guard alone is green without a mutation', () => {
  const result = runGuard();
  expect(result.status).toBe(0);
}, 45_000);

describe.each(['listed', 'unlisted'] as const)('%s workout day reader', (where) => {
  it.each(mutations)('LS-917R3 B1: rejects %s rather than silently placing it', (_name, body) => {
    if (fs.existsSync(fresh)) throw new Error('Refusing to overwrite a probe');
    const original = fs.readFileSync(listed, 'utf8');
    const destination = where === 'listed' ? listed : fresh;
    const header = `import type { WorkoutRowLike } from './workoutDoneToday';\nimport { workoutDay } from './workoutDay';\n`;
    try {
      fs.writeFileSync(destination, (where === 'listed' ? original : header) + '\n' + body + '\n');
      const result = runGuard();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(path.basename(destination));
    } finally {
      fs.writeFileSync(listed, original);
      fs.rmSync(fresh, { force: true });
    }
  }, 45_000);
});
