/**
 * Explicit-Save payload field-parity tests (MWB-4 #237 R11 P1).
 *
 * The backend `setExercises` endpoint is a FULL REPLACE: every persisted field
 * omitted from a row is reset to null. `weight_lbs` and `superset_group_id` are
 * carried in local state and preserved by the autosave diff + replay/adoption
 * path, so omitting them from the explicit-Save payload silently erased
 * server-preserved weights and supersets the coach never re-entered.
 *
 * `buildSetExercisesPayload` is the pure transform the screen's Save button
 * runs over its draft rows. These tests lock the field parity directly (no
 * brittle full-screen render) and assert every produced row matches the
 * UpsertExerciseRowInput contract (no null leaks for optional fields) so the
 * payload can never be a shape the backend would reject.
 */

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

describe('buildSetExercisesPayload — explicit Save field parity (MWB-4 #237 R11 P1)', () => {
  it('retains weight_lbs and superset_group_id that replay/adoption populated, so an explicit Save does NOT erase them', () => {
    // A row whose weight (185 lbs) and superset group ('G1') were populated by
    // the server (folded in via replay/adoption) — the coach never re-typed
    // them. An explicit Save must round-trip BOTH, not drop them to null.
    const rows: DraftExerciseRow[] = [
      draftRow({ weight_lbs: 185, superset_group_id: 'G1' }),
    ];

    const payload = buildSetExercisesPayload(rows);

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

    const payload = buildSetExercisesPayload(rows);

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

    const payload = buildSetExercisesPayload(rows);

    expect(payload.map((p) => p.order)).toEqual([1, 2, 3]);
    expect(payload.map((p) => p.weight_lbs)).toEqual([135, 225, undefined]);
    expect(payload.map((p) => p.superset_group_id)).toEqual(['G1', 'G1', undefined]);
  });

  it('produces rows that match the UpsertExerciseRowInput contract (required fields present; optional fields are number/string or undefined, never null)', () => {
    const rows: DraftExerciseRow[] = [
      draftRow({ weight_lbs: 185, superset_group_id: 'G1', notes: 'tempo' }),
      draftRow({ exercise_external_id: 'ex-2', weight_lbs: null, superset_group_id: null }),
    ];

    const payload = buildSetExercisesPayload(rows);

    for (const rowInput of payload) {
      // Required fields are always present and correctly typed.
      expect(typeof rowInput.exercise_external_id).toBe('string');
      expect(typeof rowInput.order).toBe('number');
      expect(typeof rowInput.sets).toBe('number');
      expect(typeof rowInput.reps_or_duration_seconds).toBe('number');
      // Optional fields are either their value type or undefined - NEVER null
      // (a null would be rejected by the backend's optional-field contract).
      for (const key of [
        'weight_lbs',
        'rest_seconds',
        'superset_group_id',
        'notes',
      ] as const) {
        const v = (rowInput as unknown as Record<string, unknown>)[key];
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
