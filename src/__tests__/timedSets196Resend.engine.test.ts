/**
 * TIMED-SETS-M (agent 196), the phone half of SET-ASKED (b#1219): a logged
 * plan exercise names its plan row (plan_assignment_id, plan_order). Today's
 * production server refuses both fields with a 400 that names them, so the
 * phone resends the same workout once without them, under the same key, and
 * keeps the workout queued until that resend answers. Any other 400 is
 * handled as on main (dead letter, no resend).
 * Harness copied from lo917SaveKeyProof.engine.test.ts.
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
        return r ? { id: r.id, sync_status: r.sync_status, server_id: r.server_id, payload: r.payload, assignment_json: r.assignment_json } : null;
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
// SET-ASKED-BE (b#1219) adds these two; today's production refuses them.
const PLAN_KEYS = ['plan_assignment_id', 'plan_order'];
function mockHttpError(status: number, message: string | string[] = 'Bad Request') {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { statusCode: status, message, error: 'Bad Request' } } });
}
function mockValidateWorkout(body: Record<string, unknown>): void {
  // forbidNonWhitelisted names each unknown field, as Nest does.
  const exercises = Array.isArray(body.exercises) ? (body.exercises as Array<Record<string, unknown>>) : [];
  const unknownPlan = mockServer.setAsked ? [] : exercises.flatMap((e, i) =>
    PLAN_KEYS.filter((k) => k in e).map((k) => `exercises.${i}.property ${k} should not exist`));
  if (unknownPlan.length) throw mockHttpError(400, unknownPlan);
  const exerciseKeys = [...EXERCISE_KEYS, ...PLAN_KEYS];
  const bad =
    Object.keys(body).some((k) => !WORKOUT_KEYS.includes(k)) ||
    typeof body.workout_name !== 'string' ||
    typeof body.workout_type !== 'string' ||
    !Array.isArray(body.exercises) ||
    (body.exercises as Array<Record<string, unknown>>).some(
      (e) =>
        Object.keys(e).some((k) => !exerciseKeys.includes(k)) ||
        !MUSCLE_GROUPS.includes(String(e.muscle_group)) ||
        typeof e.exercise_name !== 'string',
    );
  if (bad) throw mockHttpError(400, ['exercises.0.muscle_group must be one of the following values']);
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
  setAsked: boolean;
} = { workouts: [], keys: new Map(), loseNextReply: false, setAsked: false };
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
const mockUpdate = jest.fn(async (id: string, body: Record<string, unknown>) => {
  mockValidateWorkout(body);
  return { data: { id } };
});
jest.mock('../services/api', () => ({
  workoutApi: {
    create: (body: Record<string, unknown>, config?: { headers?: Record<string, unknown> }) => mockCreate(body, config),
    update: (id: string, body: Record<string, unknown>) => mockUpdate(id, body),
    getAll: jest.fn(async () => ({ data: [] })),
  },
}));
const mockComplete = jest.fn(async (_id: string, _input: unknown) => ({ data: {} }));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: (id: string, input: unknown) => mockComplete(id, input) },
}));

jest.mock('../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'client-1' })),
  readUserCache: jest.fn(async () => ({ id: 'client-1' })),
}));

type Engine = typeof import('../offline/sync/sync-engine');
type SaveKey = typeof import('../offline/sync/workoutSaveKey');
type Db = typeof import('../offline/database');
let engine: Engine;
let saveKey: SaveKey;
let database: Db;
function loadModules() {
  // A fresh module registry is a cold app start: no in-memory held keys,
  // no cached database handle; only the SQLite rows survive.
  jest.isolateModules(() => {
    engine = require('../offline/sync/sync-engine');
    saveKey = require('../offline/sync/workoutSaveKey');
    database = require('../offline/database');
  });
}

const ASG = 'a3c2b1d0-0000-4000-8000-0000000000aa';
function coreDayBody(refs = true) {
  const plan = (order: number) => (refs ? { plan_assignment_id: ASG, plan_order: order } : {});
  return {
    date: '2026-11-04',
    workout_name: 'Core day',
    workout_type: 'strength',
    duration_minutes: 30,
    notes: 'Core day',
    exercises: [
      { exercise_name: 'Front Plank', muscle_group: 'core', sets_completed: 3, weight_per_set: [0, 0, 0], reps_per_set: [60, 60, 60], ...plan(1) },
      { exercise_name: 'Back Squat', muscle_group: 'legs', sets_completed: 1, weight_per_set: [135], reps_per_set: [5], ...plan(2) },
    ],
  };
}
const KEY = 'client-1:1761867000000';
const sentKeys = () => mockCreate.mock.calls.map((c) => (c[1] as { headers?: Record<string, unknown> } | undefined)?.headers?.['Idempotency-Key']);
const timeout = () => Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });

beforeEach(async () => {
  mockDb.rows.length = 0;
  mockServer.workouts = [];
  mockServer.keys = new Map();
  mockServer.loseNextReply = false;
  mockServer.setAsked = false;
  mockCreate.mockClear();
  mockUpdate.mockClear();
  mockComplete.mockReset();
  mockComplete.mockImplementation(async () => ({ data: {} }));
  loadModules();
  await database.__resetDatabaseForTests();
});

const noPlanRefs = (b: unknown) => (b as { exercises: Array<Record<string, unknown>> }).exercises.every(
  (e) => !('plan_assignment_id' in e) && !('plan_order' in e));

describe('a 400 that names plan_assignment_id or plan_order', () => {
  it('online save: resends once without both fields, same key, same body otherwise', async () => {
    const res = await saveKey.createWorkoutOnce(coreDayBody(), KEY);
    expect(res.data).toEqual({ id: 'srv-1' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(sentKeys()).toEqual([KEY, KEY]);
    expect(noPlanRefs(mockCreate.mock.calls[0][0])).toBe(false);
    expect(mockCreate.mock.calls[1][0]).toEqual(coreDayBody(false));
    expect(mockServer.workouts).toHaveLength(1);
  });

  it('queued workout: synced after the one resend, not dead-lettered', async () => {
    await engine.queueWorkout({ clientKey: KEY, payload: coreDayBody(), userId: 'client-1', sessionName: 'Core day', durationMinutes: 30 });
    await engine.releaseQueuedWorkout(KEY, timeout());
    await engine.pushQueuedWorkouts();
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(sentKeys()).toEqual([KEY, KEY]);
    expect(mockDb.rows[0].sync_status).toBe('synced');
    expect(mockDb.rows[0].server_id).toBe('srv-1');
  });

  it('stays queued when the resend gets no answer, and is sent again later', async () => {
    await engine.queueWorkout({ clientKey: KEY, payload: coreDayBody(), userId: 'client-1', sessionName: 'Core day', durationMinutes: 30 });
    await engine.releaseQueuedWorkout(KEY, timeout());
    mockServer.loseNextReply = true;
    await engine.pushQueuedWorkouts();
    expect(mockDb.rows[0].sync_status).toBe('pending');
    await engine.pushQueuedWorkouts();
    expect(mockDb.rows[0].sync_status).toBe('synced');
    expect(mockServer.workouts).toHaveLength(1);
    expect(new Set(sentKeys())).toEqual(new Set([KEY]));
  });

  it('a server that takes the fields gets them, in one call', async () => {
    mockServer.setAsked = true;
    await saveKey.createWorkoutOnce(coreDayBody(), KEY);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockServer.workouts[0].exercises).toEqual(coreDayBody().exercises);
  });

  it('PUT: a queued edit is resent once without the fields', async () => {
    const res = await saveKey.updateWorkoutOnce('srv-9', coreDayBody());
    expect(res.data).toEqual({ id: 'srv-9' });
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[1][1]).toEqual(coreDayBody(false));
  });
});

describe('every other 400 is as on main', () => {
  it('a 400 that does not name the fields is dead-lettered with no resend', async () => {
    const body = coreDayBody();
    body.exercises[0].muscle_group = 'abs';
    await engine.queueWorkout({ clientKey: KEY, payload: body, userId: 'client-1', sessionName: 'Core day', durationMinutes: 30 });
    await engine.releaseQueuedWorkout(KEY, timeout());
    mockServer.setAsked = true;
    await engine.pushQueuedWorkouts();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockDb.rows[0].sync_status).toBe('dead_letter');
  });

  it('a body without the fields is never resent', async () => {
    const body = coreDayBody(false);
    body.exercises[0].muscle_group = 'abs';
    await expect(saveKey.createWorkoutOnce(body, KEY)).rejects.toMatchObject({ response: { status: 400 } });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
