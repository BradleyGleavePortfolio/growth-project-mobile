/**
 * workoutBuilderAutosaveDiff unit tests (MWB-4).
 *
 * The diff is the part most likely to silently send the wrong op, so it is
 * tested as a pure function: every op kind (plan_meta / upsert / remove /
 * reorder), the new-row-without-id case, the added-then-removed no-op case, and
 * the "nothing changed -> []" baseline that keeps an untouched screen quiet.
 *
 * Every produced op is ALSO round-tripped through the strict AutosaveOpSchema
 * so a diff can never emit a shape the backend would 400 on.
 */

import {
  diffWorkingCopy,
  type WorkoutBuilderWorkingCopy,
} from '../workoutBuilderAutosaveDiff';
import { AutosaveOpSchema, type AutosaveOp } from '../../../api/workoutAutosaveApi';

const UID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function row(
  over: Partial<WorkoutBuilderWorkingCopy['rows'][number]> = {},
): WorkoutBuilderWorkingCopy['rows'][number] {
  return {
    rowId: undefined,
    exerciseExternalId: 'ex-1',
    sets: 3,
    repsOrDurationSeconds: 10,
    restSeconds: 60,
    weightLbs: null,
    supersetGroupId: null,
    notes: null,
    ...over,
  };
}

function copy(
  rows: WorkoutBuilderWorkingCopy['rows'],
  meta?: Partial<WorkoutBuilderWorkingCopy['meta']>,
): WorkoutBuilderWorkingCopy {
  return { meta: { name: 'Push day', type: 'strength', ...meta }, rows };
}

/** Assert every op validates against the strict backend-mirror schema. */
function expectAllOpsValid(ops: AutosaveOp[]): void {
  for (const op of ops) {
    expect(AutosaveOpSchema.safeParse(op).success).toBe(true);
  }
}

describe('diffWorkingCopy', () => {
  it('returns [] when nothing changed', () => {
    const c = copy([row({ rowId: UID_A })]);
    expect(diffWorkingCopy(c, c)).toEqual([]);
  });

  it('emits a plan_meta op when the name changes', () => {
    const prev = copy([], { name: 'Old' });
    const next = copy([], { name: 'New name' });
    const ops = diffWorkingCopy(prev, next);
    expect(ops).toEqual([{ op: 'plan_meta', meta: { name: 'New name' } }]);
    expectAllOpsValid(ops);
  });

  it('emits a plan_meta op when the type changes', () => {
    const prev = copy([], { type: 'strength' });
    const next = copy([], { type: 'cardio' });
    const ops = diffWorkingCopy(prev, next);
    expect(ops).toEqual([{ op: 'plan_meta', meta: { type: 'cardio' } }]);
    expectAllOpsValid(ops);
  });

  it('ignores a blank name (does not emit an empty plan_meta)', () => {
    const prev = copy([], { name: 'Has name' });
    const next = copy([], { name: '   ' });
    expect(diffWorkingCopy(prev, next)).toEqual([]);
  });

  it('emits an upsert WITHOUT row_id for a brand-new on-device row', () => {
    const prev = copy([]);
    const next = copy([row({ exerciseExternalId: 'squat' })]);
    const ops = diffWorkingCopy(prev, next);
    expect(ops).toEqual([
      {
        op: 'upsert_exercise',
        payload: {
          exercise_external_id: 'squat',
          order: 1,
          sets: 3,
          reps_or_duration_seconds: 10,
          weight_lbs: null,
          rest_seconds: 60,
          superset_group_id: null,
          notes: null,
        },
      },
    ]);
    expectAllOpsValid(ops);
  });

  it('emits an upsert WITH row_id when a saved row field changes', () => {
    const prev = copy([row({ rowId: UID_A, sets: 3 })]);
    const next = copy([row({ rowId: UID_A, sets: 5 })]);
    const ops = diffWorkingCopy(prev, next);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'upsert_exercise', row_id: UID_A });
    expect((ops[0] as { payload: { sets: number } }).payload.sets).toBe(5);
    expectAllOpsValid(ops);
  });

  it('emits a remove_exercise for a saved row dropped from next', () => {
    const prev = copy([row({ rowId: UID_A }), row({ rowId: UID_B })]);
    const next = copy([row({ rowId: UID_A })]);
    const ops = diffWorkingCopy(prev, next);
    expect(ops).toContainEqual({ op: 'remove_exercise', row_id: UID_B });
    expectAllOpsValid(ops);
  });

  it('produces NO op for a row added then removed in the same session', () => {
    // An id-less row never persisted; dropping it leaves nothing to send.
    const prev = copy([row({ rowId: UID_A })]);
    const nextWithAdded = copy([row({ rowId: UID_A }), row({ exerciseExternalId: 'new' })]);
    const nextRemoved = copy([row({ rowId: UID_A })]);
    // add → 1 upsert; remove back → no ops vs the original baseline.
    expect(diffWorkingCopy(prev, nextWithAdded)).toHaveLength(1);
    expect(diffWorkingCopy(prev, nextRemoved)).toEqual([]);
  });

  it('emits a reorder over surviving server ids when order changes', () => {
    const prev = copy([
      row({ rowId: UID_A }),
      row({ rowId: UID_B }),
      row({ rowId: UID_C }),
    ]);
    const next = copy([
      row({ rowId: UID_C }),
      row({ rowId: UID_A }),
      row({ rowId: UID_B }),
    ]);
    const ops = diffWorkingCopy(prev, next);
    const reorder = ops.find((o) => o.op === 'reorder');
    expect(reorder).toEqual({ op: 'reorder', row_ids: [UID_C, UID_A, UID_B] });
    expectAllOpsValid(ops);
  });

  it('does not emit a reorder when only one saved row exists', () => {
    const prev = copy([row({ rowId: UID_A, sets: 3 })]);
    const next = copy([row({ rowId: UID_A, sets: 4 })]);
    const ops = diffWorkingCopy(prev, next);
    expect(ops.some((o) => o.op === 'reorder')).toBe(false);
  });

  it('orders ops meta -> upsert -> remove -> reorder', () => {
    const prev = copy([row({ rowId: UID_A }), row({ rowId: UID_B })], {
      name: 'Old',
    });
    const next = copy(
      [row({ rowId: UID_B, sets: 9 }), row({ exerciseExternalId: 'fresh' })],
      { name: 'Fresh' },
    );
    const ops = diffWorkingCopy(prev, next);
    const kinds = ops.map((o) => o.op);
    // plan_meta first, remove_exercise present for the dropped UID_A.
    expect(kinds[0]).toBe('plan_meta');
    expect(kinds).toContain('upsert_exercise');
    expect(kinds).toContain('remove_exercise');
    const removeIdx = kinds.indexOf('remove_exercise');
    const firstUpsert = kinds.indexOf('upsert_exercise');
    expect(firstUpsert).toBeLessThan(removeIdx);
    expectAllOpsValid(ops);
  });

  it('stays well under the 200-op cap for a realistic edit', () => {
    const prev = copy(
      Array.from({ length: 12 }, (_, i) => row({ rowId: `id-${i}` })),
    );
    // Touch one field on one row.
    const next = copy(
      prev.rows.map((r, i) => (i === 0 ? { ...r, sets: 99 } : r)),
    );
    const ops = diffWorkingCopy(prev, next);
    expect(ops.length).toBeLessThanOrEqual(200);
    expect(ops).toHaveLength(1);
  });
});
