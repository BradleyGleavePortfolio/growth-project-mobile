/**
 * WORKOUT-SYNC-124 (agent 124): a workout finished with no signal reaches the
 * server exactly once, with its sets, and the coach assignment is completed.
 *
 * The fake server below applies the same rules as the backend's
 * CreateWorkoutDto under ValidationPipe({ whitelist, forbidNonWhitelisted }):
 * workout_name and workout_type are required, every exercise needs a known
 * muscle_group, and unknown keys (the old `local_id`) are refused with a 400.
 */

interface Row {
  id: string;
  exercise_id: string;
  sets_data: string;
  sync_status: 'pending' | 'synced' | 'conflict' | 'dead_letter';
  logged_at: number;
  server_id: string | null;
  session_name: string | null;
  duration_minutes: number | null;
  user_id: string | null;
  payload: string | null;
  client_key: string | null;
  assignment_json: string | null;
}

const mockDb: { rows: Row[] } = { rows: [] };

function mockFakeDatabase() {
  const rows = mockDb.rows;
  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  return {
    execAsync: async () => undefined,
    closeAsync: async () => undefined,
    runAsync: async (raw: string, params: unknown[] = []) => {
      const sql = norm(raw);
      if (/^INSERT INTO workout_logs .*payload, client_key, assignment_json\)/.test(sql)) {
        const [id, logged_at, session_name, duration_minutes, user_id, payload, client_key, assignment_json] =
          params as [string, number, string | null, number | null, string | null, string, string, string | null];
        if (rows.some((r) => r.client_key === client_key)) {
          throw new Error('UNIQUE constraint failed: workout_logs.client_key');
        }
        rows.push({
          id, exercise_id: 'session', sets_data: '[]', sync_status: 'pending', logged_at,
          server_id: null, session_name, duration_minutes, user_id, payload, client_key, assignment_json,
        });
        return { changes: 1 };
      }
      if (/^INSERT INTO workout_logs/.test(sql)) {
        const [id, exercise_id, sets_data, logged_at, session_name, duration_minutes, user_id] =
          params as [string, string, string, number, string | null, number | null, string | null];
        rows.push({
          id, exercise_id, sets_data, sync_status: 'pending', logged_at, server_id: null,
          session_name, duration_minutes, user_id, payload: null, client_key: null, assignment_json: null,
        });
        return { changes: 1 };
      }
      if (/^UPDATE workout_logs SET payload = \?, assignment_json = \?, sync_status = 'pending'/.test(sql)) {
        const [payload, assignment_json, duration_minutes, user_id, id] =
          params as [string, string | null, number | null, string | null, string];
        const r = rows.find((x) => x.id === id);
        if (r) Object.assign(r, { payload, assignment_json, duration_minutes, user_id, sync_status: 'pending' });
        return { changes: r ? 1 : 0 };
      }
      if (/^UPDATE workout_logs SET sync_status = 'synced', server_id = \?, assignment_json = NULL WHERE client_key = \?$/.test(sql)) {
        const [server_id, key] = params as [string, string];
        const r = rows.find((x) => x.client_key === key);
        if (r) Object.assign(r, { sync_status: 'synced', server_id, assignment_json: null });
        return { changes: r ? 1 : 0 };
      }
      if (/^UPDATE workout_logs SET sync_status = 'dead_letter' WHERE client_key = \? AND sync_status = 'pending'$/.test(sql)) {
        const [key] = params as [string];
        const r = rows.find((x) => x.client_key === key && x.sync_status === 'pending');
        if (r) r.sync_status = 'dead_letter';
        return { changes: r ? 1 : 0 };
      }
      if (/^UPDATE workout_logs SET sync_status = 'synced', server_id = \? WHERE id = \?$/.test(sql)) {
        const [server_id, id] = params as [string, string];
        const r = rows.find((x) => x.id === id);
        if (r) Object.assign(r, { sync_status: 'synced', server_id });
        return { changes: r ? 1 : 0 };
      }
      if (/^UPDATE workout_logs SET sync_status = '(dead_letter|conflict)' WHERE id = \?$/.test(sql)) {
        const status = /'(dead_letter|conflict)'/.exec(sql)![1] as Row['sync_status'];
        const r = rows.find((x) => x.id === (params[0] as string));
        if (r) r.sync_status = status;
        return { changes: r ? 1 : 0 };
      }
      if (/^UPDATE workout_logs SET assignment_json = NULL WHERE id = \?$/.test(sql)) {
        const r = rows.find((x) => x.id === (params[0] as string));
        if (r) r.assignment_json = null;
        return { changes: r ? 1 : 0 };
      }
      throw new Error(`[fake-sqlite] runAsync: ${sql}`);
    },
    getAllAsync: async (raw: string, params: unknown[] = []) => {
      const sql = norm(raw);
      if (/^PRAGMA table_info/.test(sql)) {
        return [
          'id', 'exercise_id', 'sets_data', 'sync_status', 'logged_at', 'server_id', 'session_name',
          'duration_minutes', 'user_id', 'payload', 'client_key', 'assignment_json',
        ].map((name) => ({ name }));
      }
      if (/FROM workout_logs WHERE sync_status = 'pending' AND user_id = \?$/.test(sql)) {
        return rows.filter((r) => r.sync_status === 'pending' && r.user_id === params[0]).map((r) => ({ ...r }));
      }
      if (/FROM workout_logs WHERE assignment_json IS NOT NULL AND sync_status = 'synced' AND user_id = \?$/.test(sql)) {
        return rows
          .filter((r) => r.assignment_json != null && r.sync_status === 'synced' && r.user_id === params[0])
          .map((r) => ({ ...r }));
      }
      throw new Error(`[fake-sqlite] getAllAsync: ${sql}`);
    },
    getFirstAsync: async (raw: string, params: unknown[] = []) => {
      const sql = norm(raw);
      if (/WHERE client_key = \? LIMIT 1$/.test(sql)) {
        const r = rows.find((x) => x.client_key === params[0]);
        return r ? { id: r.id, sync_status: r.sync_status, server_id: r.server_id } : null;
      }
      if (/^SELECT COUNT\(\*\) AS n FROM workout_logs WHERE payload IS NOT NULL AND sync_status = 'pending' AND user_id = \?$/.test(sql)) {
        return { n: rows.filter((r) => r.payload != null && r.sync_status === 'pending' && r.user_id === params[0]).length };
      }
      if (/WHERE server_id = \? LIMIT 1$/.test(sql)) {
        const r = rows.find((x) => x.server_id === params[0]);
        return r ? { id: r.id } : null;
      }
      throw new Error(`[fake-sqlite] getFirstAsync: ${sql}`);
    },
  };
}

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockFakeDatabase()),
}));

// ── Fake server: CreateWorkoutDto rules ──────────────────────────────────────
const MUSCLE_GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'cardio', 'full_body'];
const WORKOUT_KEYS = ['date', 'workout_name', 'workout_type', 'duration_minutes', 'intensity', 'notes', 'exercises'];
const EXERCISE_KEYS = ['exercise_name', 'muscle_group', 'sets_completed', 'reps_per_set', 'weight_per_set', 'rpe', 'notes', 'video_url'];
function mockHttpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });
}
function mockValidateWorkout(body: Record<string, unknown>): void {
  const bad =
    Object.keys(body).some((k) => !WORKOUT_KEYS.includes(k)) ||
    typeof body.workout_name !== 'string' ||
    typeof body.workout_type !== 'string' ||
    !Array.isArray(body.exercises) ||
    (body.exercises as Array<Record<string, unknown>>).some(
      (e) =>
        Object.keys(e).some((k) => !EXERCISE_KEYS.includes(k)) ||
        !MUSCLE_GROUPS.includes(String(e.muscle_group)) ||
        typeof e.exercise_name !== 'string',
    );
  if (bad) throw mockHttpError(400);
}
const mockServer: { workouts: Array<Record<string, unknown>>; offline: boolean } = { workouts: [], offline: false };
const mockCreate = jest.fn(async (body: Record<string, unknown>) => {
  if (mockServer.offline) throw new Error('Network Error');
  mockValidateWorkout(body);
  const id = `srv-${mockServer.workouts.length + 1}`;
  mockServer.workouts.push({ id, ...body });
  return { data: { id } };
});
jest.mock('../services/api', () => ({
  workoutApi: {
    create: (body: Record<string, unknown>) => mockCreate(body),
    getAll: jest.fn(async () => ({ data: [] })),
  },
}));

const mockCompleteAssignment = jest.fn(async (_id: string, _input: Record<string, unknown>) => {
  if (mockServer.offline) throw new Error('Network Error');
  return { data: {} };
});
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: {
    completeMyAssignment: (id: string, input: Record<string, unknown>) => mockCompleteAssignment(id, input),
  },
}));

jest.mock('../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'client-1' })),
  readUserCache: jest.fn(async () => ({ id: 'client-1' })),
}));

import { __resetDatabaseForTests } from '../offline/database';
import {
  queueWorkout,
  settleQueuedWorkout,
  releaseQueuedWorkout,
  countQueuedWorkouts,
  pushQueuedWorkouts,
  triggerSync,
  writeWorkoutLog,
  workoutSyncEvents,
} from '../offline/sync/sync-engine';

// The body ActiveWorkoutScreen builds for "Push Day" (bench 135x8, 145x6).
function pushDayBody() {
  return {
    date: '2026-10-06',
    workout_name: 'Push Day',
    workout_type: 'strength',
    duration_minutes: 42,
    notes: 'Push Day',
    exercises: [
      {
        exercise_name: 'Bench Press',
        muscle_group: 'chest',
        sets_completed: 2,
        weight_per_set: [135, 145],
        reps_per_set: [8, 6],
      },
    ],
  };
}

let keySeq = 0;
const nextKey = () => `client-1:${1_760_000_000_000 + ++keySeq}`;

beforeEach(async () => {
  mockDb.rows.length = 0;
  mockServer.workouts = [];
  mockServer.offline = false;
  mockCreate.mockClear();
  mockCompleteAssignment.mockClear();
  await __resetDatabaseForTests();
});

describe('workout finished with no signal', () => {
  it('reaches the server with every set once the phone is back online', async () => {
    const key = nextKey();
    // Finish tapped in the gym basement: stored, the screen's own POST fails.
    await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1', sessionName: 'Push Day', durationMinutes: 42 });
    await releaseQueuedWorkout(key);
    expect(await countQueuedWorkouts('client-1')).toBe(1);

    const synced = jest.fn();
    workoutSyncEvents.on('synced', synced);
    try {
      await triggerSync();
    } finally {
      workoutSyncEvents.off('synced', synced);
    }

    expect(mockServer.workouts).toHaveLength(1);
    expect(mockServer.workouts[0]).toMatchObject({
      workout_name: 'Push Day',
      exercises: [{ exercise_name: 'Bench Press', weight_per_set: [135, 145], reps_per_set: [8, 6] }],
    });
    expect(mockDb.rows[0].sync_status).toBe('synced');
    expect(await countQueuedWorkouts('client-1')).toBe(0);
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it('the old per-exercise rows are what the server refused (regression anchor)', async () => {
    // Pre-fix path: one row per exercise, body rebuilt without workout_name /
    // muscle_group and with local_id. The fake server refuses it exactly like
    // the real one, which is why offline workouts never reached the coach.
    await writeWorkoutLog({ exerciseId: 'bench-press', setsData: JSON.stringify([{ reps: 8, weight: 135, completed: true }]), sessionName: 'Push Day', durationMinutes: 42 });
    await triggerSync();
    expect(mockServer.workouts).toHaveLength(0);
    expect(mockDb.rows[0].sync_status).toBe('dead_letter');
  });

  it('stays queued while there is still no signal and goes out on the next sync', async () => {
    const key = nextKey();
    await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1' });
    await releaseQueuedWorkout(key);

    mockServer.offline = true;
    await triggerSync();
    expect(mockDb.rows[0].sync_status).toBe('pending');

    mockServer.offline = false;
    await pushQueuedWorkouts();
    expect(mockServer.workouts).toHaveLength(1);
    expect(mockDb.rows[0].sync_status).toBe('synced');
  });

  it('marks the coach assignment complete after the workout is on the server', async () => {
    const key = nextKey();
    const input = {
      completion_payload: { exercises: [{ exerciseName: 'Bench Press', sets: [] }] },
      idempotency_key: '0b6f2a3e-4b1c-4d2e-9f00-1a2b3c4d5e6f',
      started_at: '2026-10-06T17:00:00.000Z',
    };
    await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1', assignment: { assignmentId: 'asg-1', input } });
    await releaseQueuedWorkout(key);

    await triggerSync();

    expect(mockServer.workouts).toHaveLength(1);
    expect(mockCompleteAssignment).toHaveBeenCalledTimes(1);
    expect(mockCompleteAssignment).toHaveBeenCalledWith('asg-1', input);
    expect(mockDb.rows[0].assignment_json).toBeNull();
  });
});

describe('exactly once', () => {
  it('Finish tapped again for the same workout keeps one queued copy and one server workout', async () => {
    const key = nextKey();
    await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1' });
    await releaseQueuedWorkout(key);
    await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1' });
    await releaseQueuedWorkout(key);
    expect(mockDb.rows).toHaveLength(1);

    await triggerSync();
    await triggerSync();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockServer.workouts).toHaveLength(1);
  });

  it('the background sync never sends a workout the screen is still saving, nor after it saved', async () => {
    const key = nextKey();
    await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1' });
    // Screen POST in flight: a reconnect / foreground sync fires meanwhile.
    await triggerSync();
    expect(mockCreate).not.toHaveBeenCalled();

    // Screen POST succeeded.
    await settleQueuedWorkout(key, 'srv-screen');
    await triggerSync();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDb.rows[0]).toMatchObject({ sync_status: 'synced', server_id: 'srv-screen' });

    // Same session finished again (app closed before the screen cleared).
    const again = await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1' });
    expect(again).toMatchObject({ alreadySynced: true, serverId: 'srv-screen' });
    await triggerSync();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a body the server refuses is parked, not retried on every sync', async () => {
    const key = nextKey();
    await queueWorkout({ clientKey: key, payload: { ...pushDayBody(), workout_type: undefined }, userId: 'client-1' });
    await releaseQueuedWorkout(key);
    await triggerSync();
    await triggerSync();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockDb.rows[0].sync_status).toBe('dead_letter');
  });
});
