/**
 * WORKOUT-REFUSAL-M (203-P1 Style 2): a saved workout the server refused keeps the server's code, words and next
 * step (backend b#1256, CONTRACT 7170540475), and Send again / Remove from this phone act on that one row only.
 * An answer with no code (the old server, or a refusal the server leaves uncoded) keeps today's behaviour: the row
 * parks with nothing kept, so no card shows (A5 rule 5).
 */
interface Row {
  id: string; sync_status: string; logged_at: number; server_id: string | null; user_id: string | null;
  payload: string | null; client_key: string | null; assignment_json: string | null; refusal: string | null;
  exercise_id: string; sets_data: string; session_name: string | null; duration_minutes: number | null;
}
const mockRows: Row[] = [];
const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function mockFakeDatabase() {
  const rows = mockRows;
  const find = (id: unknown) => rows.find((r) => r.id === id);
  return {
    execAsync: async () => undefined,
    closeAsync: async () => undefined,
    runAsync: async (raw: string, p: unknown[] = []) => {
      const sql = norm(raw);
      if (sql.startsWith("UPDATE workout_logs SET payload = ?, assignment_json = ?, sync_status = 'pending', refusal = NULL")) {
        const r = find(p[4]);
        if (r) Object.assign(r, { payload: p[0], assignment_json: p[1], sync_status: 'pending', refusal: null });
        return { changes: r ? 1 : 0 };
      }
      if (sql === "UPDATE workout_logs SET sync_status = 'dead_letter' WHERE id = ?") {
        const r = find(p[0]);
        if (r) r.sync_status = 'dead_letter';
        return { changes: r ? 1 : 0 };
      }
      if (sql === "UPDATE workout_logs SET sync_status = 'dead_letter' WHERE client_key = ? AND sync_status = 'pending'") {
        const r = rows.find((x) => x.client_key === p[0] && x.sync_status === 'pending');
        if (r) r.sync_status = 'dead_letter';
        return { changes: r ? 1 : 0 };
      }
      if (sql === 'UPDATE workout_logs SET refusal = ? WHERE id = ?') {
        const r = find(p[1]);
        if (r) r.refusal = p[0] as string;
        return { changes: r ? 1 : 0 };
      }
      if (sql === "UPDATE workout_logs SET refusal = ? WHERE client_key = ? AND sync_status = 'dead_letter'") {
        const r = rows.find((x) => x.client_key === p[1] && x.sync_status === 'dead_letter');
        if (r) r.refusal = p[0] as string;
        return { changes: r ? 1 : 0 };
      }
      if (sql === "UPDATE workout_logs SET sync_status = 'pending', refusal = NULL WHERE id = ? AND user_id = ? AND sync_status = 'dead_letter'") {
        const r = rows.find((x) => x.id === p[0] && x.user_id === p[1] && x.sync_status === 'dead_letter');
        if (r) Object.assign(r, { sync_status: 'pending', refusal: null });
        return { changes: r ? 1 : 0 };
      }
      if (sql === "UPDATE workout_logs SET sync_status = 'synced', server_id = ? WHERE id = ?") {
        const r = find(p[1]);
        if (r) Object.assign(r, { sync_status: 'synced', server_id: p[0] });
        return { changes: r ? 1 : 0 };
      }
      if (sql === "DELETE FROM workout_logs WHERE id = ? AND user_id = ? AND sync_status = 'dead_letter'") {
        const i = rows.findIndex((x) => x.id === p[0] && x.user_id === p[1] && x.sync_status === 'dead_letter');
        if (i >= 0) rows.splice(i, 1);
        return { changes: i >= 0 ? 1 : 0 };
      }
      throw new Error(`[fake-sqlite] runAsync: ${sql}`);
    },
    getAllAsync: async (raw: string, p: unknown[] = []) => {
      const sql = norm(raw);
      if (/^PRAGMA table_info/.test(sql)) return [];
      if (/FROM workout_logs WHERE sync_status = 'pending' AND user_id = \?$/.test(sql)) {
        return rows.filter((r) => r.sync_status === 'pending' && r.user_id === p[0]).map((r) => ({ ...r }));
      }
      if (/WHERE sync_status = 'dead_letter' AND payload IS NOT NULL AND refusal IS NOT NULL AND user_id = \? ORDER BY logged_at$/.test(sql)) {
        return rows.filter((r) => r.sync_status === 'dead_letter' && r.payload != null && r.refusal != null && r.user_id === p[0])
          .sort((a, b) => a.logged_at - b.logged_at).map((r) => ({ id: r.id, payload: r.payload, refusal: r.refusal }));
      }
      if (/WHERE assignment_json IS NOT NULL AND sync_status = 'synced' AND user_id = \?$/.test(sql)) return [];
      throw new Error(`[fake-sqlite] getAllAsync: ${sql}`);
    },
    getFirstAsync: async (raw: string, p: unknown[] = []) => {
      const sql = norm(raw);
      if (/WHERE id = \? AND user_id = \? AND sync_status = 'pending'$/.test(sql)) {
        const r = rows.find((x) => x.id === p[0] && x.user_id === p[1] && x.sync_status === 'pending');
        return r ? { ...r } : null;
      }
      if (/WHERE client_key = \? LIMIT 1$/.test(sql)) {
        const r = rows.find((x) => x.client_key === p[0]);
        return r ? { id: r.id, sync_status: r.sync_status, server_id: r.server_id, payload: r.payload } : null;
      }
      throw new Error(`[fake-sqlite] getFirstAsync: ${sql}`);
    },
  };
}

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockFakeDatabase()) }));
jest.mock('../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'c1' }),
  readUserCache: async () => ({ id: 'c1' }),
}));
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../services/api', () => ({
  workoutApi: { create: (...a: unknown[]) => mockCreate(...a), update: (...a: unknown[]) => mockUpdate(...a), getAll: jest.fn() },
}));
jest.mock('../api/workoutBuilderApi', () => ({ workoutBuilderApi: { completeMyAssignment: jest.fn() } }));
jest.mock('../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn(async () => undefined) } }));
jest.mock('../services/sentry', () => ({ captureErrorWithoutPii: jest.fn() }));

import {
  listRefusedWorkouts,
  pushQueuedWorkouts,
  queueWorkout,
  releaseQueuedWorkout,
  removeRefusedWorkout,
  sendRefusedWorkoutAgain,
  workoutSyncEvents,
} from '../offline/sync/sync-engine';
import { canSendAgain, readRefusal, refusalLines, refusalOf } from '../offline/sync/refusal';
import { __resetDatabaseForTests } from '../offline/database';

const W2 = 'If an app update is waiting, install it, then send it again.';
const W3 = 'This workout is no longer in your history. Remove it from this phone.';
const answer = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const INVALID = answer(400, { statusCode: 400, code: 'WORKOUT_INVALID', message: ['property surprise should not exist', 'x'], error: 'Bad Request', next_step: W2 });
const NOT_FOUND = answer(404, { statusCode: 404, code: 'WORKOUT_NOT_FOUND', message: 'Workout not found', error: 'Not Found', next_step: W3 });
const OLD_SERVER = answer(400, { statusCode: 400, message: ['property surprise should not exist'], error: 'Bad Request' });
const BODY = { date: '2026-10-10', workout_name: 'Upper body B', workout_type: 'strength', duration_minutes: 48, notes: '', exercises: [] };

function row(id: string, extra: Partial<Row> = {}): Row {
  return {
    id, sync_status: 'pending', logged_at: Date.now(), server_id: null, user_id: 'c1', payload: JSON.stringify(BODY),
    client_key: `c1:${id}-1790000000000`, assignment_json: null, refusal: null, exercise_id: 'session', sets_data: '[]',
    session_name: 'Upper body B', duration_minutes: 48, ...extra,
  };
}

beforeEach(async () => {
  mockRows.length = 0;
  jest.clearAllMocks();
  await __resetDatabaseForTests();
});

describe('refusalOf: what the phone keeps from an answer', () => {
  it.each([
    ['WORKOUT_INVALID, the validation lines: the first line', INVALID, { status: 400, code: 'WORKOUT_INVALID', said: 'property surprise should not exist', nextStep: W2 }],
    ['WORKOUT_NOT_FOUND, a sentence', NOT_FOUND, { status: 404, code: 'WORKOUT_NOT_FOUND', said: 'Workout not found', nextStep: W3 }],
    ['the old server: no code', OLD_SERVER, null],
    ['a code with no next step (ACCOUNT_DELETED)', answer(403, { code: 'ACCOUNT_DELETED', message: 'Account has been deleted' }), null],
    ['a next step with no code', answer(400, { message: 'x', next_step: W2 }), null],
    ['no answer (no signal)', new Error('Network Error'), null],
    ['a body that is not an object', answer(500, 'oops' as unknown as Record<string, unknown>), null],
  ])('%s', (_name, err, expected) => {
    expect(refusalOf(err)).toEqual(expected);
  });

  it('reads back what it stored; anything else is nothing', () => {
    const kept = refusalOf(NOT_FOUND)!;
    expect(readRefusal(JSON.stringify(kept))).toEqual(kept);
    expect(readRefusal('{not json')).toBeNull();
    expect(readRefusal(null)).toBeNull();
    expect(readRefusal(JSON.stringify({ code: 'X' }))).toBeNull();
  });

  it('Send again is offered unless the workout is gone from the server; the lines quote the server', () => {
    const copy = { said: 'The server said:', invalid: "Part of this workout couldn't be saved." };
    expect(canSendAgain(refusalOf(INVALID)!)).toBe(true);
    expect(canSendAgain(refusalOf(NOT_FOUND)!)).toBe(false);
    expect(refusalLines(refusalOf(NOT_FOUND)!, copy)).toEqual(['The server said:\n“Workout not found”', W3]);
    expect(refusalLines({ status: 400, code: 'X', said: '', nextStep: W2 }, copy)).toEqual([W2]);
  });

  it('OPERATOR RULING 7208809287 item 3: WORKOUT_INVALID never shows a validation line, only the plain line and the next step', () => {
    const copy = { said: 'The server said:', invalid: "Part of this workout couldn't be saved." };
    const kept = refusalOf(INVALID)!;
    expect(kept.said).toBe('property surprise should not exist'); // stored as the server sent it (CONTRACT 7203245014)
    const lines = refusalLines(kept, copy);
    expect(lines).toEqual(["Part of this workout couldn't be saved.", W2]);
    expect(lines.join('\n')).not.toMatch(/property|should not exist|The server said/);
  });
});

describe('the queue keeps the reason with the parked row', () => {
  it.each([
    ['POST refused with WORKOUT_INVALID', null, INVALID, 'WORKOUT_INVALID'],
    ['PUT of a removed workout refused with WORKOUT_NOT_FOUND', 'srv-1', NOT_FOUND, 'WORKOUT_NOT_FOUND'],
    ['the old server (no code): parked, nothing kept, nothing listed', null, OLD_SERVER, null],
  ])('%s', async (_name, serverId, err, code) => {
    mockRows.push(row('a', { server_id: serverId }));
    mockCreate.mockRejectedValue(err);
    mockUpdate.mockRejectedValue(err);
    await pushQueuedWorkouts();
    expect(mockRows[0].sync_status).toBe('dead_letter');
    const listed = await listRefusedWorkouts('c1');
    expect(listed.map((x) => x.refusal.code)).toEqual(code ? [code] : []);
    if (code) expect(listed[0].body).toMatchObject({ workout_name: 'Upper body B', date: '2026-10-10' });
  });

  it('the Finish screen\'s refusal is kept too; Finish again clears it', async () => {
    mockRows.push(row('a'));
    await releaseQueuedWorkout('c1:a-1790000000000', INVALID);
    expect((await listRefusedWorkouts('c1')).map((x) => x.refusal.nextStep)).toEqual([W2]);
    await queueWorkout({ clientKey: 'c1:a-1790000000000', payload: BODY, userId: 'c1' });
    expect(mockRows[0]).toMatchObject({ sync_status: 'pending', refusal: null });
    expect(await listRefusedWorkouts('c1')).toEqual([]);
    // The Finish screen holds the key until its answer: no answer this time, so the hold ends.
    await releaseQueuedWorkout('c1:a-1790000000000', new Error('Network Error'));
  });

  it('another member\'s refused row is never listed, sent again or removed', async () => {
    mockRows.push(row('mine', { sync_status: 'dead_letter', refusal: JSON.stringify(refusalOf(INVALID)) }));
    mockRows.push(row('theirs', { user_id: 'c2', sync_status: 'dead_letter', refusal: JSON.stringify(refusalOf(INVALID)) }));
    expect((await listRefusedWorkouts('c1')).map((x) => x.id)).toEqual(['mine']);
    expect(await sendRefusedWorkoutAgain('theirs', 'c1')).toBe('kept');
    await removeRefusedWorkout('theirs', 'c1');
    expect(mockRows.find((r) => r.id === 'theirs')).toMatchObject({ sync_status: 'dead_letter' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('Send again and Remove from this phone', () => {
  const parked = () => row('a', { sync_status: 'dead_letter', refusal: JSON.stringify(refusalOf(INVALID)) });

  it.each([
    ['accepted: sent, gone from the list, the tab refreshes', () => mockCreate.mockResolvedValue({ data: { id: 'srv-9' } }), 'sent', 'synced', 'synced', 0],
    ['refused again: parked again with the reason (R4b)', () => mockCreate.mockRejectedValue(INVALID), 'dead_letter', 'dead_letter', 'queued', 1],
    ['no answer: back in the queue, the waiting row counts it', () => mockCreate.mockRejectedValue(new Error('Network Error')), 'kept', 'pending', 'queued', 0],
  ])('%s', async (_name, server, outcome, status, event, listed) => {
    mockRows.push(parked());
    server();
    const heard: string[] = [];
    const on = (name: string) => () => heard.push(name);
    const synced = on('synced');
    const queued = on('queued');
    workoutSyncEvents.on('synced', synced);
    workoutSyncEvents.on('queued', queued);
    try {
      expect(await sendRefusedWorkoutAgain('a', 'c1')).toBe(outcome);
    } finally {
      workoutSyncEvents.off('synced', synced);
      workoutSyncEvents.off('queued', queued);
    }
    expect(mockCreate).toHaveBeenCalledWith(BODY, { headers: { 'Idempotency-Key': 'c1:a-1790000000000' } });
    expect(mockRows[0].sync_status).toBe(status);
    expect(heard).toEqual([event]);
    expect(await listRefusedWorkouts('c1')).toHaveLength(listed);
  });

  it('removes only that parked row', async () => {
    mockRows.push(parked(), row('b'));
    await removeRefusedWorkout('a', 'c1');
    expect(mockRows.map((r) => r.id)).toEqual(['b']);
    await removeRefusedWorkout('b', 'c1');
    expect(mockRows.map((r) => r.id)).toEqual(['b']);
  });
});
