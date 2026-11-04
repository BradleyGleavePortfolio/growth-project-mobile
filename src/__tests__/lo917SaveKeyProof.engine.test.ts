/**
 * LO-917 (agent 189, Opus lens of m#917 @ 7671c9f4): proof for JOB-SPECIFIC
 * items 1 and 2. One stored workout per Finish: the same Idempotency-Key on
 * the fresh save, the save after a timeout, after an app restart with the row
 * still queued, and for a legacy queued row; a key outside the server rule is
 * never sent; a queued body stays unchanged under its key. The assignment's
 * done call is kept until the server answers, retried after a timeout or 5xx,
 * never sent twice, and dropped (not retried) on a 4xx.
 * Harness copied from loWorkout187LostReply.engine.test.ts.
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
const KEY = 'client-1:1761867000000';
const sentKeys = () => mockCreate.mock.calls.map((c) => (c[1] as { headers?: Record<string, unknown> } | undefined)?.headers?.['Idempotency-Key']);
const timeout = () => Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });

beforeEach(async () => {
  mockDb.rows.length = 0;
  mockServer.workouts = [];
  mockServer.keys = new Map();
  mockServer.loseNextReply = false;
  mockCreate.mockClear();
  mockComplete.mockReset();
  mockComplete.mockImplementation(async () => ({ data: {} }));
  loadModules();
  await database.__resetDatabaseForTests();
});

describe('LO-917 item 1: one key per Finish', () => {
  it('fresh save, retry after a timeout and retry after an app restart all send the queue key; one workout is stored; the body is the queued body', async () => {
    await engine.queueWorkout({ clientKey: KEY, payload: pushDayBody(), userId: 'client-1', sessionName: 'Push Day', durationMinutes: 42 });
    const queued = mockDb.rows[0].payload;
    // Fresh save from the screen: the answer is lost.
    mockServer.loseNextReply = true;
    let lost: unknown = null;
    try { await saveKey.createWorkoutOnce(pushDayBody(), KEY); } catch (e) { lost = e; }
    await engine.releaseQueuedWorkout(KEY, lost);
    // Background retry in the same run: its answer is lost too.
    mockServer.loseNextReply = true;
    await engine.pushQueuedWorkouts();
    expect(mockDb.rows[0].sync_status).toBe('pending');
    expect(mockDb.rows[0].payload).toBe(queued);
    // App killed and restarted: fresh modules, the row is still queued.
    loadModules();
    await engine.pushQueuedWorkouts();
    expect(sentKeys()).toEqual([KEY, KEY, KEY]);
    for (const call of mockCreate.mock.calls.slice(1)) expect(call[0]).toEqual(JSON.parse(queued as string));
    expect(mockServer.workouts).toHaveLength(1);
    expect(mockDb.rows[0].sync_status).toBe('synced');
    expect(mockDb.rows[0].server_id).toBe('srv-1');
  });

  it('a legacy queued row (no payload) is sent with its own row id as the key on every retry', async () => {
    const id = 'mgx2k1a9f3c2b1d0';
    mockDb.rows.push({
      id, exercise_id: 'Bench Press', sets_data: JSON.stringify([{ reps: 8, weight: 135, completed: true }]),
      sync_status: 'pending', logged_at: Date.UTC(2026, 9, 30, 18), server_id: null, session_name: 'Push Day',
      duration_minutes: 30, user_id: 'client-1', payload: null, client_key: null, assignment_json: null,
    });
    // Point the fake server's body rules away: this row predates them.
    mockCreate.mockImplementationOnce(async () => { throw timeout(); });
    await engine.pushQueuedWorkouts();
    loadModules();
    mockCreate.mockImplementationOnce(async () => ({ data: { id: 'srv-legacy' } }));
    await engine.pushQueuedWorkouts();
    expect(sentKeys()).toEqual([id, id]);
    expect(mockCreate.mock.calls[0][0]).toEqual(mockCreate.mock.calls[1][0]);
  });

  it.each([
    ['too short', 'k:1'],
    ['a space', 'client 1:1761867000000'],
    ['longer than 128', 'k'.repeat(129)],
  ])('a queued key outside the server rule (%s) is never sent as Idempotency-Key', async (_l, bad) => {
    await engine.queueWorkout({ clientKey: bad, payload: pushDayBody(), userId: 'client-1', sessionName: 'Push Day', durationMinutes: 42 });
    await engine.releaseQueuedWorkout(bad, timeout());
    await engine.pushQueuedWorkouts();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1]).toBeUndefined();
  });
});

describe('LO-917 item 2: the assignment done call', () => {
  const assignment = { assignmentId: 'asg-1', input: { completion_payload: { exercises: [] }, idempotency_key: 'asg-key-1', started_at: '2026-10-30T17:00:00.000Z' } };

  async function finishSaved() {
    await engine.queueWorkout({ clientKey: KEY, payload: pushDayBody(), userId: 'client-1', sessionName: 'Push Day', durationMinutes: 42, assignment });
    const res = await saveKey.createWorkoutOnce(pushDayBody(), KEY);
    return engine.settleQueuedWorkout(KEY, String((res.data as { id: string }).id));
  }

  it('kept after a timeout and a 503, sent again with the same key, then never again', async () => {
    mockComplete.mockImplementationOnce(async () => { throw timeout(); });
    expect(await finishSaved()).toBe(false);
    expect(mockDb.rows[0].assignment_json).not.toBeNull();
    mockComplete.mockImplementationOnce(async () => { throw mockHttpError(503); });
    await engine.pushQueuedWorkouts();
    expect(mockDb.rows[0].assignment_json).not.toBeNull();
    loadModules();
    await engine.pushQueuedWorkouts();
    expect(mockDb.rows[0].assignment_json).toBeNull();
    await engine.pushQueuedWorkouts();
    await engine.pushQueuedWorkouts();
    expect(mockComplete).toHaveBeenCalledTimes(3);
    for (const c of mockComplete.mock.calls) expect(c).toEqual(['asg-1', assignment.input]);
    expect(mockServer.workouts).toHaveLength(1);
  });

  it('answered on the first try: sent exactly once', async () => {
    expect(await finishSaved()).toBe(true);
    await engine.pushQueuedWorkouts();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404, 409])('a %s answer is final: cleared, not retried', async (status) => {
    mockComplete.mockImplementationOnce(async () => { throw mockHttpError(status); });
    await finishSaved();
    expect(mockDb.rows[0].assignment_json).toBeNull();
    await engine.pushQueuedWorkouts();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it.each([401, 408, 429])('a %s answer is kept and retried', async (status) => {
    mockComplete.mockImplementationOnce(async () => { throw mockHttpError(status); });
    await finishSaved();
    expect(mockDb.rows[0].assignment_json).not.toBeNull();
    await engine.pushQueuedWorkouts();
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(mockDb.rows[0].assignment_json).toBeNull();
  });
});
