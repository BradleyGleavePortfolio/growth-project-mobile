/**
 * Explicit-Save payload field-parity tests (MWB-4 #237 R11 P1 + R14 D-001).
 *
 * The backend `setExercises` endpoint is a FULL REPLACE: every persisted field
 * omitted from a row is reset to null. `weight_lbs` and `superset_group_id` are
 * carried in local state and preserved by the autosave diff + replay/adoption
 * path, so omitting them from the FLAG-ON explicit-Save payload silently erased
 * server-preserved weights and supersets the coach never re-entered.
 *
 * R14 D-001: those two fields are now gated on the autosave feature flag.
 * `buildSetExercisesPayload(rows, autosaveEnabled)` is the pure transform the
 * screen's Save button runs over its draft rows:
 *   - FLAG OFF -> the body MUST be BYTE-IDENTICAL to the legacy base-branch
 *     shape: exactly `exercise_external_id`, `order`, `sets`,
 *     `reps_or_duration_seconds`, `rest_seconds`, `notes`, in that key order,
 *     and NEITHER `weight_lbs` NOR `superset_group_id`.
 *   - FLAG ON  -> the fuller payload that round-trips weight_lbs +
 *     superset_group_id at parity with autosave.
 *
 * These tests lock both branches directly (no brittle full-screen render) and
 * assert every produced row matches the UpsertExerciseRowInput contract (no
 * null leaks for optional fields) so the payload can never be a shape the
 * backend would reject.
 */

import type { UpsertExerciseRowInput } from '../../../api/workoutBuilderApi';
import {
  buildSetExercisesPayload,
  type DraftExerciseRow,
} from '../CoachWorkoutBuilderScreen';

function draftRow(over: Partial<DraftExerciseRow> = {}): DraftExerciseRow {
  return {
    clientId: 'client-1',
    row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    exercise_external_id: 'ex-bench',
    display_name: 'Bench Press',
    sets: 4,
    reps_or_duration_seconds: 8,
    rest_seconds: 90,
    weight_lbs: null,
    superset_group_id: null,
    notes: null,
    ...over,
  };
}

describe('buildSetExercisesPayload — flag-OFF legacy byte-identical payload (MWB-4 #237 R14 D-001)', () => {
  /**
   * The exact legacy payload the base branch produced for a single row, as a
   * literal in legacy key order. The flag-off builder output MUST be deeply
   * equal to this AND serialize byte-for-byte the same.
   */
  function legacyRow(
    over: Partial<{
      exercise_external_id: string;
      order: number;
      sets: number;
      reps_or_duration_seconds: number;
      rest_seconds: number | undefined;
      notes: string | undefined;
    }> = {},
  ): Record<string, unknown> {
    return {
      exercise_external_id: 'ex-bench',
      order: 1,
      sets: 4,
      reps_or_duration_seconds: 8,
      rest_seconds: 90,
      notes: undefined,
      ...over,
    };
  }

  it('emits exactly the legacy keys (no weight_lbs, no superset_group_id) even when those local values are set', () => {
    // A row whose weight and superset WERE populated locally. With the flag off
    // the legacy Save MUST NOT carry them — byte-identical to the base branch.
    const rows: DraftExerciseRow[] = [
      draftRow({ weight_lbs: 185, superset_group_id: 'G1', rest_seconds: 90 }),
    ];

    const payload = buildSetExercisesPayload(rows, false);

    expect(payload).toHaveLength(1);
    expect(payload[0]).toEqual(legacyRow());
    // Explicit key-set guard: only the six legacy keys, in legacy order.
    expect(Object.keys(payload[0])).toEqual([
      'exercise_external_id',
      'order',
      'sets',
      'reps_or_duration_seconds',
      'rest_seconds',
      'notes',
    ]);
    expect('weight_lbs' in payload[0]).toBe(false);
    expect('superset_group_id' in payload[0]).toBe(false);
  });

  it('is BYTE-IDENTICAL to the legacy base-branch JSON body across multiple rows', () => {
    const rows: DraftExerciseRow[] = [
      draftRow({
        exercise_external_id: 'ex-a',
        sets: 3,
        reps_or_duration_seconds: 10,
        rest_seconds: 60,
        notes: 'tempo',
        weight_lbs: 135,
        superset_group_id: 'G1',
      }),
      draftRow({
        exercise_external_id: 'ex-b',
        sets: 5,
        reps_or_duration_seconds: 5,
        rest_seconds: null,
        notes: null,
        weight_lbs: 225,
        superset_group_id: 'G1',
      }),
    ];

    const payload = buildSetExercisesPayload(rows, false);

    // The exact body the legacy base-branch mapping would have produced:
    //   exercise_external_id, order, sets, reps_or_duration_seconds,
    //   rest_seconds (?? undefined), notes (?? undefined) — and nothing else.
    const legacyExpected = [
      legacyRow({
        exercise_external_id: 'ex-a',
        order: 1,
        sets: 3,
        reps_or_duration_seconds: 10,
        rest_seconds: 60,
        notes: 'tempo',
      }),
      legacyRow({
        exercise_external_id: 'ex-b',
        order: 2,
        sets: 5,
        reps_or_duration_seconds: 5,
        rest_seconds: undefined,
        notes: undefined,
      }),
    ];

    expect(payload).toEqual(legacyExpected);
    // Byte-for-byte JSON parity: JSON.stringify drops `undefined` values, so the
    // serialized PUT body matches the legacy wire shape exactly.
    expect(JSON.stringify(payload)).toBe(JSON.stringify(legacyExpected));
  });

  it('never includes weight_lbs / superset_group_id keys in any flag-off row', () => {
    const rows: DraftExerciseRow[] = [
      draftRow({ exercise_external_id: 'ex-a', weight_lbs: 135, superset_group_id: 'G1' }),
      draftRow({ exercise_external_id: 'ex-b', weight_lbs: null, superset_group_id: null }),
    ];

    const payload = buildSetExercisesPayload(rows, false);

    for (const row of payload) {
      expect('weight_lbs' in row).toBe(false);
      expect('superset_group_id' in row).toBe(false);
    }
  });
});

describe('buildSetExercisesPayload — flag-ON explicit Save field parity (MWB-4 #237 R11 P1)', () => {
  it('retains weight_lbs and superset_group_id that replay/adoption populated, so an explicit Save does NOT erase them', () => {
    // A row whose weight (185 lbs) and superset group ('G1') were populated by
    // the server (folded in via replay/adoption) — the coach never re-typed
    // them. An explicit Save must round-trip BOTH, not drop them to null.
    const rows: DraftExerciseRow[] = [
      draftRow({ weight_lbs: 185, superset_group_id: 'G1' }),
    ];

    const payload = buildSetExercisesPayload(rows, true);

    expect(payload).toHaveLength(1);
    expect(payload[0].weight_lbs).toBe(185);
    expect(payload[0].superset_group_id).toBe('G1');
    // The other persisted fields ride through unchanged, in row order. This
    // row's notes were null locally, so they serialize as undefined.
    expect(payload[0]).toEqual({
      exercise_external_id: 'ex-bench',
      order: 1,
      sets: 4,
      reps_or_duration_seconds: 8,
      weight_lbs: 185,
      rest_seconds: 90,
      superset_group_id: 'G1',
      notes: undefined,
    });
  });

  it('maps null local values to undefined so the row input stays schema-clean (never sends null)', () => {
    const rows: DraftExerciseRow[] = [
      draftRow({
        weight_lbs: null,
        superset_group_id: null,
        rest_seconds: null,
        notes: null,
      }),
    ];

    const payload = buildSetExercisesPayload(rows, true);

    expect(payload[0].weight_lbs).toBeUndefined();
    expect(payload[0].superset_group_id).toBeUndefined();
    expect(payload[0].rest_seconds).toBeUndefined();
    expect(payload[0].notes).toBeUndefined();
  });

  it('assigns 1-based order matching row position and preserves multi-row weight/superset parity', () => {
    const rows: DraftExerciseRow[] = [
      draftRow({ exercise_external_id: 'ex-a', weight_lbs: 135, superset_group_id: 'G1' }),
      draftRow({ exercise_external_id: 'ex-b', weight_lbs: 225, superset_group_id: 'G1' }),
      draftRow({ exercise_external_id: 'ex-c', weight_lbs: null, superset_group_id: null }),
    ];

    const payload = buildSetExercisesPayload(rows, true);

    expect(payload.map((p) => p.order)).toEqual([1, 2, 3]);
    expect(payload.map((p) => p.weight_lbs)).toEqual([135, 225, undefined]);
    expect(payload.map((p) => p.superset_group_id)).toEqual(['G1', 'G1', undefined]);
  });

  it('produces rows that match the UpsertExerciseRowInput contract (required fields present; optional fields are number/string or undefined, never null)', () => {
    const rows: DraftExerciseRow[] = [
      draftRow({ weight_lbs: 185, superset_group_id: 'G1', notes: 'tempo' }),
      draftRow({ exercise_external_id: 'ex-2', weight_lbs: null, superset_group_id: null }),
    ];

    const payload = buildSetExercisesPayload(rows, true);

    for (const rowInput of payload) {
      // Required fields are always present and correctly typed.
      expect(typeof rowInput.exercise_external_id).toBe('string');
      expect(typeof rowInput.order).toBe('number');
      expect(typeof rowInput.sets).toBe('number');
      expect(typeof rowInput.reps_or_duration_seconds).toBe('number');
      // Optional fields are either their value type or undefined - NEVER null
      // (a null would be rejected by the backend's optional-field contract).
      const optionalKeys = [
        'weight_lbs',
        'rest_seconds',
        'superset_group_id',
        'notes',
      ] as const satisfies readonly (keyof UpsertExerciseRowInput)[];
      for (const key of optionalKeys) {
        const v = rowInput[key];
        expect(v === undefined || v !== null).toBe(true);
      }
      expect(
        rowInput.weight_lbs === undefined ||
          typeof rowInput.weight_lbs === 'number',
      ).toBe(true);
      expect(
        rowInput.superset_group_id === undefined ||
          typeof rowInput.superset_group_id === 'string',
      ).toBe(true);
    }
  });
});
