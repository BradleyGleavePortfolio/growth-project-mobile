/**
 * Unit tests for the offline sync engine.
 *
 * Strategy:
 *   - Use the LokiJS in-memory WatermelonDB adapter (auto-selected in test env).
 *   - Mock `workoutApi` from ../../services/api so no real network calls fire.
 *   - Reset the DB singleton between tests via __resetDatabaseForTests().
 */

jest.mock('../../services/api', () => ({
  workoutApi: {
    create: jest.fn(),
    getAll: jest.fn(),
  },
}));

import { workoutApi } from '../../services/api';
import { __resetDatabaseForTests } from '../../offline/database';
import {
  writeWorkoutLog,
  triggerSync,
  conflictToastEvents,
} from '../../offline/sync/sync-engine';
import { getDatabase } from '../../offline/database';
import WorkoutLog from '../../offline/models/WorkoutLog';
import { Q } from '@nozbe/watermelondb';

const mockedCreate = workoutApi.create as jest.MockedFunction<typeof workoutApi.create>;
const mockedGetAll = workoutApi.getAll as jest.MockedFunction<typeof workoutApi.getAll>;

beforeEach(() => {
  __resetDatabaseForTests();
  jest.clearAllMocks();
  // Default pull stub: return empty list so pull step is a no-op.
  mockedGetAll.mockResolvedValue({ data: [] } as never);
});

// ─── writeWorkoutLog ──────────────────────────────────────────────────────────

describe('writeWorkoutLog', () => {
  it('creates a WorkoutLog record with sync_status=pending', async () => {
    const record = await writeWorkoutLog({
      exerciseId: 'bench-press',
      setsData: JSON.stringify([{ reps: 8, weight: 100, completed: true }]),
      sessionName: 'Chest Day',
      durationMinutes: 45,
    });

    expect(record.syncStatus).toBe('pending');
    expect(record.exerciseId).toBe('bench-press');
    expect(record.sessionName).toBe('Chest Day');
  });

  it('parsedSets returns typed array from setsData', async () => {
    const sets = [
      { reps: 8, weight: 100, completed: true },
      { reps: 6, weight: 110, completed: true },
    ];
    const record = await writeWorkoutLog({
      exerciseId: 'squat',
      setsData: JSON.stringify(sets),
    });

    expect(record.parsedSets).toEqual(sets);
  });
});

// ─── triggerSync — push pending ──────────────────────────────────────────────

describe('triggerSync — push pending records', () => {
  it('marks a pending record as synced after a successful API call', async () => {
    mockedCreate.mockResolvedValue({ data: { id: 'srv-001' } } as never);

    await writeWorkoutLog({
      exerciseId: 'deadlift',
      setsData: JSON.stringify([{ reps: 5, weight: 200, completed: true }]),
      sessionName: 'Back Day',
      durationMinutes: 60,
    });

    await triggerSync();

    const db = getDatabase();
    const all = await db.get<WorkoutLog>('workout_logs').query().fetch();
    expect(all).toHaveLength(1);
    expect(all[0].syncStatus).toBe('synced');
    expect(all[0].serverId).toBe('srv-001');
  });

  it('leaves the record as pending when the API throws a network error', async () => {
    mockedCreate.mockRejectedValue(new Error('Network Error'));

    await writeWorkoutLog({
      exerciseId: 'press',
      setsData: JSON.stringify([{ reps: 10, weight: 60, completed: true }]),
      sessionName: 'Shoulder Day',
    });

    await triggerSync();

    const db = getDatabase();
    const all = await db.get<WorkoutLog>('workout_logs').query().fetch();
    expect(all[0].syncStatus).toBe('pending');
  });

  it('marks the record as conflict and emits toast event on HTTP 409', async () => {
    const conflictErr = Object.assign(new Error('Conflict'), {
      response: { status: 409 },
    });
    mockedCreate.mockRejectedValue(conflictErr);

    let toastFired = false;
    conflictToastEvents.once('conflict', () => {
      toastFired = true;
    });

    await writeWorkoutLog({
      exerciseId: 'row',
      setsData: JSON.stringify([{ reps: 12, weight: 80, completed: true }]),
    });

    await triggerSync();

    const db = getDatabase();
    const all = await db.get<WorkoutLog>('workout_logs').query().fetch();
    expect(all[0].syncStatus).toBe('conflict');
    expect(toastFired).toBe(true);
  });

  it('does not push records already marked synced', async () => {
    mockedCreate.mockResolvedValue({ data: { id: 'srv-002' } } as never);

    // Write one pending, sync it.
    await writeWorkoutLog({
      exerciseId: 'curl',
      setsData: JSON.stringify([{ reps: 15, weight: 20, completed: true }]),
    });
    await triggerSync();

    // Second triggerSync — create should NOT be called again.
    await triggerSync();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('syncs multiple pending records independently', async () => {
    mockedCreate
      .mockResolvedValueOnce({ data: { id: 'srv-a' } } as never)
      .mockResolvedValueOnce({ data: { id: 'srv-b' } } as never);

    await writeWorkoutLog({ exerciseId: 'a', setsData: '[]' });
    await writeWorkoutLog({ exerciseId: 'b', setsData: '[]' });

    await triggerSync();

    const db = getDatabase();
    const synced = await db
      .get<WorkoutLog>('workout_logs')
      .query(Q.where('sync_status', 'synced'))
      .fetch();
    expect(synced).toHaveLength(2);
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });
});
