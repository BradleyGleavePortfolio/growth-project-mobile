/**
 * LO-WORKOUT (agent 187, audit of main 585616c8): a finished workout whose
 * POST reaches the server but whose answer is lost (a weak gym signal, the
 * 30 s timeout) must still end up on the server once.
 *
 * Harness copied from workoutSync124.engine.test.ts (fake SQLite + a fake
 * server with CreateWorkoutDto rules). The fake server keeps one workout per
 * idempotency key when the request carries one (an Idempotency-Key header or
 * an idempotency_key / client_key body field), the way a server-side key on
 * POST /workouts would; with no key it stores every POST, like main's
 * WorkoutService.createWorkout.
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
        return r ? { id: r.id, sync_status: r.sync_status, server_id: r.server_id, payload: r.payload } : null;
      }
      if (/^SELECT COUNT\(\*\) AS n FROM workout_logs WHERE payload IS NOT NULL AND sync_status = 'pending' AND user_id = \?$/.test(sql)) {
        return { n: rows.filter((r) => r.payload != null && r.sync_status === 'pending' && r.user_id === params[0]).length };
      }
      if (/^SELECT COUNT\(\*\) AS n FROM workout_logs WHERE payload IS NOT NULL AND sync_status IN \('pending', 'dead_letter'\) AND user_id = \?$/.test(sql)) {
        const kept = ['pending', 'dead_letter'];
        return { n: rows.filter((r) => r.payload != null && kept.includes(r.sync_status) && r.user_id === params[0]).length };
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

// ── Fake server: CreateWorkoutDto rules plus an optional idempotency key ─────
const MUSCLE_GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'cardio', 'full_body'];
const KEY_FIELDS = ['idempotency_key', 'client_key'];
const WORKOUT_KEYS = ['date', 'workout_name', 'workout_type', 'duration_minutes', 'intensity', 'notes', 'exercises', ...KEY_FIELDS];
const EXERCISE_KEYS = ['exercise_name', 'muscle_group', 'sets_completed', 'reps_per_set', 'weight_per_set', 'rpe', 'notes', 'video_url', 'exercise_external_id'];
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
function mockRequestKey(body: Record<string, unknown>, config?: { headers?: Record<string, unknown> }): string | null {
  const h = config?.headers ?? {};
  const header = h['Idempotency-Key'] ?? h['idempotency-key'];
  if (typeof header === 'string' && header) return header;
  for (const k of KEY_FIELDS) if (typeof body[k] === 'string' && body[k]) return body[k] as string;
  return null;
}
const mockServer: {
  workouts: Array<Record<string, unknown>>;
  keys: Map<string, string>;
  loseNextReply: boolean;
} = { workouts: [], keys: new Map(), loseNextReply: false };
const mockCreate = jest.fn(async (body: Record<string, unknown>, config?: { headers?: Record<string, unknown> }) => {
  mockValidateWorkout(body);
  const key = mockRequestKey(body, config);
  let id = key ? mockServer.keys.get(key) : undefined;
  if (!id) {
    id = `srv-${mockServer.workouts.length + 1}`;
    mockServer.workouts.push({ id, ...body });
    if (key) mockServer.keys.set(key, id);
  }
  if (mockServer.loseNextReply) {
    // Committed on the server, but the phone never hears back.
    mockServer.loseNextReply = false;
    throw Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
  }
  return { data: { id } };
});
jest.mock('../services/api', () => ({
  workoutApi: {
    create: (body: Record<string, unknown>, config?: { headers?: Record<string, unknown> }) => mockCreate(body, config),
    update: jest.fn(async (id: string) => ({ data: { id } })),
    getAll: jest.fn(async () => ({ data: [] })),
  },
}));

jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: jest.fn(async () => ({ data: {} })) },
}));

jest.mock('../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'client-1' })),
  readUserCache: jest.fn(async () => ({ id: 'client-1' })),
}));

import { workoutApi } from '../services/api';
import { __resetDatabaseForTests } from '../offline/database';
import { queueWorkout, releaseQueuedWorkout, triggerSync, pushQueuedWorkouts } from '../offline/sync/sync-engine';

// The body ActiveWorkoutScreen builds for "Push Day" (bench 135x8, 145x6).
function pushDayBody() {
  return {
    date: '2026-10-30',
    workout_name: 'Push Day',
    workout_type: 'strength',
    duration_minutes: 42,
    notes: 'Push Day',
    exercises: [
      { exercise_name: 'Bench Press', muscle_group: 'chest', sets_completed: 2, weight_per_set: [135, 145], reps_per_set: [8, 6] },
    ],
  };
}

beforeEach(async () => {
  mockDb.rows.length = 0;
  mockServer.workouts = [];
  mockServer.keys = new Map();
  mockServer.loseNextReply = false;
  mockCreate.mockClear();
  await __resetDatabaseForTests();
});

describe('LO-WORKOUT B1: lost reply on Finish', () => {
  it('a workout whose save reached the server but whose answer was lost is stored once after the background sync', async () => {
    const key = 'client-1:1761867000000';
    // ActiveWorkoutScreen.finishWorkout: queue the body on the phone first...
    await queueWorkout({ clientKey: key, payload: pushDayBody(), userId: 'client-1', sessionName: 'Push Day', durationMinutes: 42 });
    // ...then its own POST (useCreateWorkout -> workoutApi.create(body)). The
    // server commits it; the answer never arrives.
    mockServer.loseNextReply = true;
    let lost: unknown = null;
    try {
      await (workoutApi.create as (b: Record<string, unknown>) => Promise<unknown>)(pushDayBody());
    } catch (e) {
      lost = e;
    }
    expect(lost).not.toBeNull();
    // The screen's onError: no answer -> "Saved on this phone", the row is
    // released to the background sync.
    await releaseQueuedWorkout(key, lost);

    await triggerSync();
    await pushQueuedWorkouts();

    // The client trained once; the coach and the history must show one workout.
    expect(mockServer.workouts).toHaveLength(1);
  });
});
