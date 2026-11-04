// LS-917R2: exercise the real guard, including an added reader in a file
// already on its inventory. Product mutations exist only during this test.
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
const guard = path.join(root, 'src/__tests__/workoutDayRule.test.ts');
const listed = path.join(root, 'src/utils/workout/workoutDoneToday.ts');
const fresh = path.join(root, 'src/utils/workout/fr917DayProbeR2.ts');
const bypass = `
export const ls917r2ReadDay = (row: { date: string }) =>
  new Date(Date.parse(row.date)).toLocaleDateString('en-CA');
`;

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

it('control: a new unlisted workout reader bypassing the rule is rejected', () => {
  if (fs.existsSync(fresh)) throw new Error('Refusing to replace an existing probe');
  try {
    fs.writeFileSync(fresh, `import type { WorkoutRowLike } from './workoutDoneToday';\n${bypass}`);
    const result = runGuard();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fr917DayProbeR2.ts');
  } finally {
    fs.rmSync(fresh, { force: true });
  }
}, 45_000);

it('LS-917R2 B1: a new day reader in a listed workout file cannot bypass the shared rule', () => {
  const original = fs.readFileSync(listed, 'utf8');
  try {
    fs.writeFileSync(listed, original + bypass);
    const result = runGuard();
    expect(result.status).toBe(1);
  } finally {
    fs.writeFileSync(listed, original);
  }
}, 45_000);
