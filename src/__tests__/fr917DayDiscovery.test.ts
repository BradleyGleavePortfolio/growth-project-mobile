// FR-917 F3 (LS-917 B3, LO-917 C1), the other paths: the real day guard
// (workoutDayRule.test.ts) must catch a new day reader of each shape the
// audits named, whichever workout or assignment type, hook or API entry point
// leads to it. The probe files exist only while the child jest runs; the guard
// reads files named fr917DayProbe* only when FR917_DAY_PROBE=1, so a guard run
// elsewhere in the suite never sees them.
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
const guard = path.join(root, 'src/__tests__/workoutDayRule.test.ts');
const dir = path.join(root, 'src/utils/workout');

// [probe file, what it reads, source]
const PROBES: Array<[file: string, what: string, source: string]> = [
  ['fr917DayProbeBucket.ts', "a coach workout's date bucketed as an instant", `
    import type { WorkoutSession } from '../../screens/coach/client-detail/types';
    import { bucketDateLocal } from '../date';
    export const days = (rows: WorkoutSession[]) => rows.map((w) => bucketDateLocal(new Date(w.date)));
  `],
  ['fr917DayProbeStoredAt.ts', 'the stored-at time of a workout from the history hook', `
    import { useWorkouts } from '../../hooks/useApi';
    export function useLastDay() {
      const { data } = useWorkouts(5);
      return data?.[0]?.created_at?.slice(0, 10);
    }
  `],
  ['fr917DayProbeDone.ts', "an assignment's completed_at as its day", `
    import type { ClientWorkoutAssignmentWithPlan } from '../../api/workoutBuilderApi';
    export const doneOn = (a: ClientWorkoutAssignmentWithPlan) => a.completed_at?.split('T')[0];
  `],
  ['fr917DayProbeApi.ts', 'a workout date read straight from the API entry point', `
    import { workoutApi } from '../../services/api';
    export async function firstDay() {
      const res = await workoutApi.getAll(1);
      return (res.data as Array<{ date: string }>)[0].date.slice(0, 10);
    }
  `],
];

function runGuard() {
  const written: string[] = [];
  try {
    for (const [file, , source] of PROBES) {
      const full = path.join(dir, file);
      if (fs.existsSync(full)) throw new Error(`FR-917 probe refuses to replace ${file}`);
      fs.writeFileSync(full, source);
      written.push(full);
    }
    const result = spawnSync(process.execPath, [
      require.resolve('jest/bin/jest'), '--runInBand', '--forceExit', '--runTestsByPath', guard,
    ], {
      cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000,
      env: { ...process.env, FR917_DAY_PROBE: '1' },
    });
    if (result.error) throw result.error;
    return result;
  } finally {
    written.forEach((full) => fs.rmSync(full, { force: true }));
  }
}

let result: ReturnType<typeof spawnSync>;
beforeAll(() => { result = runGuard(); }, 70_000);

it('the guard fails while any probe is in the tree', () => {
  expect(result.status).toBe(1);
});

it.each(PROBES)('the guard names %s (%s)', (file) => {
  expect(String(result.stderr)).toContain(`src/utils/workout/${file}`);
});
