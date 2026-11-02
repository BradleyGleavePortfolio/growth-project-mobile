/**
 * LS-917R4 B1: computed keys with a statically known day field must not evade
 * the fail-closed reader guard. Every mutation lives in a private source copy.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
const guard = path.join(root, 'src/__tests__/workoutDayRule.test.ts');
const relativeListed = 'src/utils/workout/workoutDoneToday.ts';
const relativeFresh = 'src/utils/workout/ls917r4ComputedProbe.ts';
const header = `import type { WorkoutRowLike } from './workoutDoneToday';\n`;

function runGuard(tree: string) {
  const result = spawnSync(process.execPath, [
    require.resolve('jest/bin/jest'), '--runInBand', '--forceExit',
    '--runTestsByPath', guard,
  ], {
    cwd: root, encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, FR917_DAY_ROOT: tree, FR917_DAY_PROBE: '1' },
  });
  if (result.error) throw result.error;
  return result;
}

function withTree(check: (tree: string) => void) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'ls917r4-computed-'));
  try {
    fs.cpSync(path.join(root, 'src'), path.join(tree, 'src'), { recursive: true });
    check(tree);
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
  }
}

it('control: the unmodified private tree is accepted', () => {
  withTree((tree) => expect(runGuard(tree).status).toBe(0));
}, 45_000);

const knownRejected = [
  ['direct field', `export const lsR4 = (row: WorkoutRowLike) => new Date(row.date!).getDay();`],
  ['literal bracket', `export const lsR4 = (row: WorkoutRowLike) => new Date(row['date']!).getDay();`],
  ['aliased binding', `export const lsR4 = (row: WorkoutRowLike) => {
    const { date: recorded } = row; return new Date(recorded!).getDay();
  };`],
] as const;
const counterexamples = [
  ['constant computed field', `export const lsR4 = (row: WorkoutRowLike) => {
    const field = 'date'; return new Date(row[field]!).getDay();
  };`],
  ['optional constant computed field', `export const lsR4 = (row: WorkoutRowLike) => {
    const field = 'date' as const; return new Date(row?.[field]!).getDay();
  };`],
  ['constant computed binding', `export const lsR4 = (row: WorkoutRowLike) => {
    const field = 'date'; const { [field]: recorded } = row;
    return new Date(recorded!).getDay();
  };`],
] as const;

describe.each(['listed', 'unlisted'] as const)('%s day reader', (where) => {
  function rejects(body: string) {
    withTree((tree) => {
      const relative = where === 'listed' ? relativeListed : relativeFresh;
      const destination = path.join(tree, relative);
      const original = where === 'listed' ? fs.readFileSync(destination, 'utf8') : header;
      fs.writeFileSync(destination, `${original}\n${body}\n`);
      const result = runGuard(tree);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(path.basename(destination));
    });
  }

  it.each(knownRejected)('control: rejects %s', (_label, body) => rejects(body), 45_000);
  it.each(counterexamples)('LS-917R4 B1: rejects %s', (_label, body) => rejects(body), 45_000);
});
