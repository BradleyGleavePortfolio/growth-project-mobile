/**
 * Unit tests for the offline sync engine.
 *
 * Strategy:
 *   - Mock `expo-sqlite` with a minimal in-memory store. The sync engine
 *     touches a single table (`workout_logs`) with a small fixed set of
 *     SQL statements, so a hand-rolled mock that pattern-matches those
 *     statements is more reliable than wiring a real wasm SQLite into Jest.
 *   - Mock `workoutApi` from ../services/api so no real network calls fire.
 *   - Reset the DB singleton between tests via __resetDatabaseForTests().
 */

// ─── In-memory expo-sqlite mock ──────────────────────────────────────────────

interface MockRow {
  id: string;
  exercise_id: string;
  sets_data: string;
  sync_status: 'pending' | 'synced' | 'conflict';
  logged_at: number;
  server_id: string | null;
  session_name: string | null;
  duration_minutes: number | null;
}

interface MockDatabase {
  rows: MockRow[];
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, params: unknown[]) => Promise<{ changes: number }>;
  getAllAsync: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  getFirstAsync: <T>(sql: string, params?: unknown[]) => Promise<T | null>;
  closeAsync: () => Promise<void>;
}

function mockCreateDatabase(): MockDatabase {
  const rows: MockRow[] = [];

  // SQL pattern matchers — keep the parser tiny and explicit. Each pattern
  // corresponds to exactly one statement the sync engine emits.
  const PAT = {
    INSERT_LOG:
      /INSERT INTO workout_logs[\s\S]+VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*'pending'\s*,\s*\?\s*,\s*NULL\s*,\s*\?\s*,\s*\?\s*\)/i,
    INSERT_PULLED:
      /INSERT INTO workout_logs[\s\S]+VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*'synced'/i,
    UPDATE_SYNCED:
      /UPDATE workout_logs SET sync_status\s*=\s*'synced',\s*server_id\s*=\s*\?\s*WHERE id\s*=\s*\?/i,
    UPDATE_CONFLICT:
      /UPDATE workout_logs SET sync_status\s*=\s*'conflict'\s*WHERE id\s*=\s*\?/i,
    SELECT_PENDING:
      /SELECT[\s\S]+FROM workout_logs[\s\S]+WHERE sync_status\s*=\s*'pending'/i,
    SELECT_BY_SERVER_ID:
      /SELECT id FROM workout_logs WHERE server_id\s*=\s*\?\s*LIMIT 1/i,
    SELECT_ALL:
      /SELECT[\s\S]+FROM workout_logs(?!\s+WHERE)(?:\s+LIMIT|\s*$)/i,
    // W-1 helper: UPDATE all pending rows in a session at once.
    UPDATE_SESSION_SYNCED:
      /UPDATE workout_logs[\s\S]+SET sync_status\s*=\s*'synced'[\s\S]+WHERE sync_status\s*=\s*'pending'[\s\S]+AND session_name\s*=\s*\?[\s\S]+AND logged_at\s*>=\s*\?/i,
    // Targeted SELECTs by session_name — used in the W-1 regression tests.
    SELECT_BY_SESSION:
      /SELECT[\s\S]+FROM workout_logs\s+WHERE session_name\s*=\s*\?/i,
  };

  const db: MockDatabase = {
    rows,
    execAsync: async (sql: string) => {
      // CREATE TABLE / CREATE INDEX / PRAGMA — no-op for the mock.
      if (
        /CREATE TABLE|CREATE INDEX|PRAGMA/i.test(sql) ||
        sql.trim() === ''
      ) {
        return;
      }
      throw new Error(`[mock-sqlite] unrecognized execAsync: ${sql}`);
    },

    runAsync: async (sql: string, params: unknown[] = []) => {
      if (PAT.INSERT_LOG.test(sql)) {
        const [
          id,
          exercise_id,
          sets_data,
          logged_at,
          session_name,
          duration_minutes,
        ] = params as [
          string,
          string,
          string,
          number,
          string | null,
          number | null,
        ];
        rows.push({
          id,
          exercise_id,
          sets_data,
          sync_status: 'pending',
          logged_at,
          server_id: null,
          session_name,
          duration_minutes,
        });
        return { changes: 1 };
      }

      if (PAT.INSERT_PULLED.test(sql)) {
        const [
          id,
          exercise_id,
          sets_data,
          logged_at,
          server_id,
          session_name,
          duration_minutes,
        ] = params as [
          string,
          string,
          string,
          number,
          string,
          string,
          number | null,
        ];
        rows.push({
          id,
          exercise_id,
          sets_data,
          sync_status: 'synced',
          logged_at,
          server_id,
          session_name,
          duration_minutes,
        });
        return { changes: 1 };
      }

      if (PAT.UPDATE_SYNCED.test(sql)) {
        const [server_id, id] = params as [string, string];
        const r = rows.find((x) => x.id === id);
        if (r) {
          r.sync_status = 'synced';
          r.server_id = server_id;
        }
        return { changes: r ? 1 : 0 };
      }

      if (PAT.UPDATE_CONFLICT.test(sql)) {
        const [id] = params as [string];
        const r = rows.find((x) => x.id === id);
        if (r) r.sync_status = 'conflict';
        return { changes: r ? 1 : 0 };
      }

      if (PAT.UPDATE_SESSION_SYNCED.test(sql)) {
        const [server_id, session_name, logged_at_floor] = params as [
          string,
          string,
          number,
        ];
        let changes = 0;
        for (const r of rows) {
          if (
            r.sync_status === 'pending' &&
            r.session_name === session_name &&
            r.logged_at >= logged_at_floor
          ) {
            r.sync_status = 'synced';
            r.server_id = server_id;
            changes++;
          }
        }
        return { changes };
      }

      throw new Error(`[mock-sqlite] unrecognized runAsync: ${sql}`);
    },

    getAllAsync: async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => {
      if (PAT.SELECT_PENDING.test(sql)) {
        return rows.filter((r) => r.sync_status === 'pending') as unknown as T[];
      }
      if (PAT.SELECT_BY_SESSION.test(sql)) {
        const [session_name] = params as [string];
        return rows.filter((r) => r.session_name === session_name) as unknown as T[];
      }
      if (PAT.SELECT_ALL.test(sql)) {
        return [...rows] as unknown as T[];
      }
      throw new Error(`[mock-sqlite] unrecognized getAllAsync: ${sql}`);
    },

    getFirstAsync: async <T,>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T | null> => {
      if (PAT.SELECT_BY_SERVER_ID.test(sql)) {
        const [server_id] = params as [string];
        const found = rows.find((r) => r.server_id === server_id);
        return (found ?? null) as unknown as T | null;
      }
      throw new Error(`[mock-sqlite] unrecognized getFirstAsync: ${sql}`);
    },

    closeAsync: async () => {
      rows.length = 0;
    },
  };

  return db;
}

// Jest hoists jest.mock factories above all top-level code, so the factory
// cannot close over outer bindings unless their identifier starts with `mock`.
// `mockDbHolder` is therefore safely accessible from inside the factory.
const mockDbHolder: { current: MockDatabase | null } = { current: null };

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => {
    const db = mockCreateDatabase();
    mockDbHolder.current = db;
    return db;
  }),
}));

jest.mock('../services/api', () => ({
  workoutApi: {
    create: jest.fn(),
    getAll: jest.fn(),
  },
}));

import { workoutApi } from '../services/api';
import { __resetDatabaseForTests, getDatabase } from '../offline/database';
import {
  writeWorkoutLog,
  triggerSync,
  conflictToastEvents,
  markSessionSyncedBySessionName,
  pullFromServer,
} from '../offline/sync/sync-engine';

const mockedCreate = workoutApi.create as jest.MockedFunction<
  typeof workoutApi.create
>;
const mockedGetAll = workoutApi.getAll as jest.MockedFunction<
  typeof workoutApi.getAll
>;

beforeEach(async () => {
  await __resetDatabaseForTests();
  mockDbHolder.current = null;
  jest.clearAllMocks();
  // Default pull stub: return empty list so the pull step is a no-op and
  // tests that only care about push behaviour aren't polluted by pull rows.
  mockedGetAll.mockResolvedValue({ data: [] } as never);
});

// ─── writeWorkoutLog ─────────────────────────────────────────────────────────

describe('writeWorkoutLog', () => {
  it('B2: refuses to write a row with an empty exerciseId', async () => {
    await expect(
      writeWorkoutLog({ exerciseId: '', setsData: '[]' }),
    ).rejects.toThrow(/exerciseId is required/);
    await expect(
      writeWorkoutLog({ exerciseId: '   ', setsData: '[]' }),
    ).rejects.toThrow(/exerciseId is required/);
  });

  it('creates a workout_logs row with sync_status=pending', async () => {
    const record = await writeWorkoutLog({
      exerciseId: 'bench-press',
      setsData: JSON.stringify([{ reps: 8, weight: 100, completed: true }]),
      sessionName: 'Chest Day',
      durationMinutes: 45,
    });

    expect(record.syncStatus).toBe('pending');
    expect(record.exerciseId).toBe('bench-press');
    expect(record.sessionName).toBe('Chest Day');
    expect(record.durationMinutes).toBe(45);
    expect(record.serverId).toBeNull();
    // The DB-side row is also there.
    const db = await getDatabase();
    const all = await db.getAllAsync<{ sync_status: string }>(
      'SELECT id, exercise_id, sets_data, sync_status, logged_at, server_id, session_name, duration_minutes FROM workout_logs',
    );
    expect(all).toHaveLength(1);
    expect(all[0].sync_status).toBe('pending');
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

    const db = await getDatabase();
    const all = await db.getAllAsync<{
      sync_status: string;
      server_id: string | null;
    }>(
      'SELECT id, exercise_id, sets_data, sync_status, logged_at, server_id, session_name, duration_minutes FROM workout_logs',
    );
    expect(all).toHaveLength(1);
    expect(all[0].sync_status).toBe('synced');
    expect(all[0].server_id).toBe('srv-001');
  });

  it('leaves the record as pending when the API throws a network error', async () => {
    mockedCreate.mockRejectedValue(new Error('Network Error'));

    await writeWorkoutLog({
      exerciseId: 'press',
      setsData: JSON.stringify([{ reps: 10, weight: 60, completed: true }]),
      sessionName: 'Shoulder Day',
    });

    await triggerSync();

    const db = await getDatabase();
    const all = await db.getAllAsync<{ sync_status: string }>(
      'SELECT id, exercise_id, sets_data, sync_status, logged_at, server_id, session_name, duration_minutes FROM workout_logs',
    );
    expect(all[0].sync_status).toBe('pending');
  });

  it('marks the record as conflict and emits toast event on HTTP 409', async () => {
    const conflictErr = Object.assign(new Error('Conflict'), {
      response: { status: 409 },
    });
    mockedCreate.mockRejectedValue(conflictErr);

    let toastFired = false;
    const onConflict = () => {
      toastFired = true;
    };
    conflictToastEvents.on('conflict', onConflict);

    await writeWorkoutLog({
      exerciseId: 'row',
      setsData: JSON.stringify([{ reps: 12, weight: 80, completed: true }]),
    });

    await triggerSync();

    const db = await getDatabase();
    const all = await db.getAllAsync<{ sync_status: string }>(
      'SELECT id, exercise_id, sets_data, sync_status, logged_at, server_id, session_name, duration_minutes FROM workout_logs',
    );
    expect(all[0].sync_status).toBe('conflict');
    expect(toastFired).toBe(true);

    conflictToastEvents.off('conflict', onConflict);
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

    const db = await getDatabase();
    const all = await db.getAllAsync<{ sync_status: string }>(
      'SELECT id, exercise_id, sets_data, sync_status, logged_at, server_id, session_name, duration_minutes FROM workout_logs',
    );
    const synced = all.filter((r) => r.sync_status === 'synced');
    expect(synced).toHaveLength(2);
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });
});

// ─── W-1: markSessionSyncedBySessionName ─────────────────────────────────────

describe('markSessionSyncedBySessionName (W-1 fix)', () => {
  it('marks all pending rows for a session as synced once the parent mutate succeeds', async () => {
    // Write three rows for the same session — same shape as ActiveWorkout
    // finishing a three-exercise workout offline-or-not.
    await writeWorkoutLog({
      exerciseId: 'bench',
      setsData: '[]',
      sessionName: 'Chest Day',
    });
    await writeWorkoutLog({
      exerciseId: 'incline',
      setsData: '[]',
      sessionName: 'Chest Day',
    });
    await writeWorkoutLog({
      exerciseId: 'fly',
      setsData: '[]',
      sessionName: 'Chest Day',
    });

    // Sanity: all pending.
    const db = await getDatabase();
    let rows = await db.getAllAsync<{ sync_status: string }>(
      'SELECT sync_status FROM workout_logs WHERE session_name = ?',
      ['Chest Day'],
    );
    expect(rows.every((r) => r.sync_status === 'pending')).toBe(true);

    const changed = await markSessionSyncedBySessionName(
      'Chest Day',
      'srv-session-1',
    );
    expect(changed).toBe(3);

    rows = await db.getAllAsync<{ sync_status: string; server_id: string }>(
      'SELECT sync_status, server_id FROM workout_logs WHERE session_name = ?',
      ['Chest Day'],
    );
    expect(rows.every((r) => r.sync_status === 'synced')).toBe(true);
    expect(rows.every((r) => r.server_id === 'srv-session-1')).toBe(true);
  });

  it('does not touch rows from a different session', async () => {
    await writeWorkoutLog({
      exerciseId: 'a',
      setsData: '[]',
      sessionName: 'Leg Day',
    });
    await writeWorkoutLog({
      exerciseId: 'b',
      setsData: '[]',
      sessionName: 'Chest Day',
    });

    await markSessionSyncedBySessionName('Chest Day', 'srv-x');

    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      session_name: string;
      sync_status: string;
    }>('SELECT session_name, sync_status FROM workout_logs');
    const byName = Object.fromEntries(
      rows.map((r) => [r.session_name, r.sync_status]),
    );
    expect(byName['Leg Day']).toBe('pending');
    expect(byName['Chest Day']).toBe('synced');
  });

  it('returns 0 and is a no-op when the session name is empty', async () => {
    await writeWorkoutLog({
      exerciseId: 'x',
      setsData: '[]',
      sessionName: 'Anything',
    });
    const changed = await markSessionSyncedBySessionName('', 'srv-x');
    expect(changed).toBe(0);
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ sync_status: string }>(
      'SELECT sync_status FROM workout_logs',
    );
    expect(rows[0].sync_status).toBe('pending');
  });
});

// ─── W-6: pullFromServer preserves multi-exercise sessions ───────────────────

describe('pullFromServer multi-exercise (W-6 fix)', () => {
  it('inserts one row per exercise when a server workout carries multiple', async () => {
    mockedGetAll.mockResolvedValueOnce({
      data: [
        {
          id: 'srv-multi',
          notes: 'Push Day',
          duration_minutes: 55,
          exercises: [
            {
              exercise_name: 'Bench',
              reps_per_set: [8, 8, 6],
              weight_per_set: [135, 145, 155],
            },
            {
              exercise_name: 'Incline DB',
              reps_per_set: [10, 10],
              weight_per_set: [50, 55],
            },
            {
              exercise_name: 'Cable Fly',
              reps_per_set: [15],
              weight_per_set: [30],
            },
          ],
        },
      ],
    } as never);

    await pullFromServer(20);

    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      exercise_id: string;
      server_id: string;
      sync_status: string;
      session_name: string;
    }>(
      'SELECT exercise_id, server_id, sync_status, session_name FROM workout_logs',
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.exercise_id).sort()).toEqual(
      ['Bench', 'Cable Fly', 'Incline DB'].sort(),
    );
    expect(rows.every((r) => r.server_id === 'srv-multi')).toBe(true);
    expect(rows.every((r) => r.sync_status === 'synced')).toBe(true);
    expect(rows.every((r) => r.session_name === 'Push Day')).toBe(true);
  });
});
