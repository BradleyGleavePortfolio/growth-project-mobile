/**
 * Unit tests for the offline sync engine.
 *
 * Strategy:
 *   - Mock `expo-sqlite` with a minimal in-memory store. The sync engine
 *     touches a single table (`workout_logs`) with a small fixed set of
 *     SQL statements, so a hand-rolled mock that pattern-matches those
 *     statements is more reliable than wiring a real wasm SQLite into Jest.
 *   - Mock `workoutApi` from ../services/api so no real network calls fire.
 *   - Mock `readUserCacheSync` so pushPending has a known current user.
 *   - Reset the DB singleton between tests via __resetDatabaseForTests().
 */

// ─── In-memory expo-sqlite mock ──────────────────────────────────────────────

interface MockRow {
  id: string;
  exercise_id: string;
  sets_data: string;
  sync_status: 'pending' | 'synced' | 'conflict' | 'dead_letter';
  logged_at: number;
  server_id: string | null;
  session_name: string | null;
  duration_minutes: number | null;
  user_id: string | null;
}

interface MockDatabase {
  rows: MockRow[];
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
  getAllAsync: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  getFirstAsync: <T>(sql: string, params?: unknown[]) => Promise<T | null>;
  closeAsync: () => Promise<void>;
}

function mockCreateDatabase(): MockDatabase {
  const rows: MockRow[] = [];

  const PAT = {
    INSERT_LOG:
      /INSERT INTO workout_logs[\s\S]+VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*'pending'\s*,\s*\?\s*,\s*NULL\s*,\s*\?\s*,\s*\?\s*,\s*\?\s*\)/i,
    INSERT_PULLED:
      /INSERT INTO workout_logs[\s\S]+VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*'synced'/i,
    UPDATE_SYNCED:
      /UPDATE workout_logs SET sync_status\s*=\s*'synced',\s*server_id\s*=\s*\?\s*WHERE id\s*=\s*\?/i,
    UPDATE_CONFLICT:
      /UPDATE workout_logs SET sync_status\s*=\s*'conflict'\s*WHERE id\s*=\s*\?/i,
    UPDATE_DEAD_LETTER:
      /UPDATE workout_logs SET sync_status\s*=\s*'dead_letter'\s*WHERE id\s*=\s*\?/i,
    SELECT_PENDING:
      /SELECT[\s\S]+FROM workout_logs[\s\S]+WHERE sync_status\s*=\s*'pending'[\s\S]+AND user_id\s*=\s*\?/i,
    SELECT_BY_SERVER_ID:
      /SELECT id FROM workout_logs WHERE server_id\s*=\s*\?\s*LIMIT 1/i,
    SELECT_ALL:
      /SELECT[\s\S]+FROM workout_logs(?!\s+WHERE)(?:\s+LIMIT|\s*$)/i,
    UPDATE_SESSION_SYNCED:
      /UPDATE workout_logs[\s\S]+SET sync_status\s*=\s*'synced'[\s\S]+WHERE sync_status\s*=\s*'pending'[\s\S]+AND session_name\s*=\s*\?[\s\S]+AND logged_at\s*>=\s*\?/i,
    SELECT_BY_SESSION:
      /SELECT[\s\S]+FROM workout_logs\s+WHERE session_name\s*=\s*\?/i,
    DELETE_BY_USER:
      /DELETE FROM workout_logs WHERE user_id\s*=\s*\?/i,
    UPDATE_BACKFILL_USER:
      /UPDATE workout_logs SET user_id\s*=\s*\?\s*WHERE user_id IS NULL/i,
    SELECT_BY_USER:
      /SELECT[\s\S]+FROM workout_logs\s+WHERE user_id\s*=\s*\?/i,
    PRAGMA_TABLE_INFO:
      /PRAGMA table_info\(workout_logs\)/i,
  };

  const db: MockDatabase = {
    rows,
    execAsync: async (sql: string) => {
      if (
        /CREATE TABLE|CREATE INDEX|PRAGMA|ALTER TABLE/i.test(sql) ||
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
          user_id,
        ] = params as [
          string,
          string,
          string,
          number,
          string | null,
          number | null,
          string | null,
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
          user_id,
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
          user_id,
        ] = params as [
          string,
          string,
          string,
          number,
          string,
          string,
          number | null,
          string | null,
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
          user_id,
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

      if (PAT.UPDATE_DEAD_LETTER.test(sql)) {
        const [id] = params as [string];
        const r = rows.find((x) => x.id === id);
        if (r) r.sync_status = 'dead_letter';
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

      if (PAT.DELETE_BY_USER.test(sql)) {
        const [user_id] = params as [string];
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].user_id === user_id) rows.splice(i, 1);
        }
        return { changes: before - rows.length };
      }

      if (PAT.UPDATE_BACKFILL_USER.test(sql)) {
        const [user_id] = params as [string];
        let changes = 0;
        for (const r of rows) {
          if (r.user_id == null) {
            r.user_id = user_id;
            changes++;
          }
        }
        return { changes };
      }

      throw new Error(`[mock-sqlite] unrecognized runAsync: ${sql}`);
    },

    getAllAsync: async <T,>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> => {
      if (PAT.PRAGMA_TABLE_INFO.test(sql)) {
        // Report the v2/v3 columns as already present so bootstrap's defensive
        // ALTER TABLEs become no-ops in the test environment. The CREATE TABLE
        // statement at bootstrap already declared user_id/dead_letter shape
        // via the mock execAsync no-op.
        return [
          { name: 'id' },
          { name: 'exercise_id' },
          { name: 'sets_data' },
          { name: 'sync_status' },
          { name: 'logged_at' },
          { name: 'server_id' },
          { name: 'session_name' },
          { name: 'duration_minutes' },
          { name: 'user_id' },
        ] as unknown as T[];
      }
      if (PAT.SELECT_PENDING.test(sql)) {
        const [user_id] = params as [string];
        return rows.filter(
          (r) => r.sync_status === 'pending' && r.user_id === user_id,
        ) as unknown as T[];
      }
      if (PAT.SELECT_BY_USER.test(sql)) {
        const [user_id] = params as [string];
        return rows.filter((r) => r.user_id === user_id) as unknown as T[];
      }
      if (PAT.SELECT_BY_SESSION.test(sql)) {
        const [session_name] = params as [string];
        return rows.filter(
          (r) => r.session_name === session_name,
        ) as unknown as T[];
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

const mockUserCache: { id: string | undefined } = { id: 'user-A' };
jest.mock('../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() =>
    mockUserCache.id ? { id: mockUserCache.id } : null,
  ),
}));

import { workoutApi } from '../services/api';
import { __resetDatabaseForTests, getDatabase } from '../offline/database';
import {
  writeWorkoutLog,
  triggerSync,
  conflictToastEvents,
  deadLetterEvents,
  markSessionSyncedBySessionName,
  pullFromServer,
  deleteWorkoutLogsForUser,
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
  mockUserCache.id = 'user-A';
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

  it('creates a workout_logs row with sync_status=pending and user_id from the cache', async () => {
    const record = await writeWorkoutLog({
      exerciseId: 'bench-press',
      setsData: JSON.stringify([{ reps: 8, weight: 100, completed: true }]),
      sessionName: 'Chest Day',
      durationMinutes: 45,
    });

    expect(record.syncStatus).toBe('pending');
    expect(record.userId).toBe('user-A');
    expect(record.exerciseId).toBe('bench-press');
    expect(record.sessionName).toBe('Chest Day');
    expect(record.durationMinutes).toBe(45);
    expect(record.serverId).toBeNull();
    expect(mockDbHolder.current?.rows).toHaveLength(1);
    expect(mockDbHolder.current?.rows[0].user_id).toBe('user-A');
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

    expect(mockDbHolder.current?.rows[0].sync_status).toBe('synced');
    expect(mockDbHolder.current?.rows[0].server_id).toBe('srv-001');
  });

  it('leaves the record as pending when the API throws a network error (transient)', async () => {
    mockedCreate.mockRejectedValue(new Error('Network Error'));

    await writeWorkoutLog({
      exerciseId: 'press',
      setsData: JSON.stringify([{ reps: 10, weight: 60, completed: true }]),
      sessionName: 'Shoulder Day',
    });

    await triggerSync();

    expect(mockDbHolder.current?.rows[0].sync_status).toBe('pending');
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

    expect(mockDbHolder.current?.rows[0].sync_status).toBe('conflict');
    expect(toastFired).toBe(true);

    conflictToastEvents.off('conflict', onConflict);
  });

  it('P1-1: marks the record as dead_letter and emits dead-letter event on HTTP 400', async () => {
    const badReq = Object.assign(new Error('Bad payload'), {
      response: { status: 400 },
    });
    mockedCreate.mockRejectedValue(badReq);

    let dlCount = 0;
    const onDl = (payload: { count: number }) => {
      dlCount = payload.count;
    };
    deadLetterEvents.on('dead_letter', onDl);

    await writeWorkoutLog({ exerciseId: 'a', setsData: '[]' });
    await writeWorkoutLog({ exerciseId: 'b', setsData: '[]' });

    await triggerSync();

    expect(
      mockDbHolder.current?.rows.every((r) => r.sync_status === 'dead_letter'),
    ).toBe(true);
    expect(dlCount).toBe(2);

    deadLetterEvents.off('dead_letter', onDl);
  });

  it('preserves pending on 5xx (transient)', async () => {
    const e503 = Object.assign(new Error('SU'), {
      response: { status: 503 },
    });
    mockedCreate.mockRejectedValue(e503);
    await writeWorkoutLog({ exerciseId: 'a', setsData: '[]' });
    await triggerSync();
    expect(mockDbHolder.current?.rows[0].sync_status).toBe('pending');
  });

  it('does not push records belonging to a different user (R15 isolation)', async () => {
    // Write under user-A
    mockUserCache.id = 'user-A';
    await writeWorkoutLog({ exerciseId: 'a', setsData: '[]' });
    // Switch to user-B; the user-A row must not be sent under B's JWT.
    mockUserCache.id = 'user-B';
    mockedCreate.mockResolvedValue({ data: { id: 'srv-x' } } as never);

    await triggerSync();

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockDbHolder.current?.rows[0].sync_status).toBe('pending');
    expect(mockDbHolder.current?.rows[0].user_id).toBe('user-A');
  });

  it('does not push when no user is signed in', async () => {
    await writeWorkoutLog({ exerciseId: 'a', setsData: '[]' });
    mockUserCache.id = undefined;
    mockedCreate.mockResolvedValue({ data: { id: 'srv-x' } } as never);

    await triggerSync();

    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('does not push records already marked synced', async () => {
    mockedCreate.mockResolvedValue({ data: { id: 'srv-002' } } as never);

    await writeWorkoutLog({ exerciseId: 'curl', setsData: '[]' });
    await triggerSync();
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

    expect(
      mockDbHolder.current?.rows.filter((r) => r.sync_status === 'synced'),
    ).toHaveLength(2);
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });
});

// ─── deleteWorkoutLogsForUser ────────────────────────────────────────────────

describe('deleteWorkoutLogsForUser (signOut helper)', () => {
  it('removes only the signing-out user\'s rows', async () => {
    mockUserCache.id = 'user-A';
    await writeWorkoutLog({ exerciseId: 'a', setsData: '[]' });
    mockUserCache.id = 'user-B';
    await writeWorkoutLog({ exerciseId: 'b', setsData: '[]' });

    const removed = await deleteWorkoutLogsForUser('user-A');

    expect(removed).toBe(1);
    const remaining = mockDbHolder.current?.rows ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].user_id).toBe('user-B');
  });

  it('returns 0 and is a no-op for the empty user id', async () => {
    await writeWorkoutLog({ exerciseId: 'a', setsData: '[]' });
    const removed = await deleteWorkoutLogsForUser('');
    expect(removed).toBe(0);
    expect(mockDbHolder.current?.rows).toHaveLength(1);
  });
});

// ─── W-1: markSessionSyncedBySessionName ─────────────────────────────────────

describe('markSessionSyncedBySessionName (W-1 fix)', () => {
  it('marks all pending rows for a session as synced once the parent mutate succeeds', async () => {
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

    rows = await db.getAllAsync<{ sync_status: string }>(
      'SELECT sync_status FROM workout_logs WHERE session_name = ?',
      ['Chest Day'],
    );
    expect(rows.every((r) => r.sync_status === 'synced')).toBe(true);
  });

  it('returns 0 and is a no-op when the session name is empty', async () => {
    await writeWorkoutLog({
      exerciseId: 'x',
      setsData: '[]',
      sessionName: 'Anything',
    });
    const changed = await markSessionSyncedBySessionName('', 'srv-x');
    expect(changed).toBe(0);
    expect(mockDbHolder.current?.rows[0].sync_status).toBe('pending');
  });
});

// ─── W-6 + P1-2: pullFromServer preserves multi-exercise sessions ────────────

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

    const rows = mockDbHolder.current?.rows ?? [];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.session_name === 'Push Day')).toBe(true);
    expect(rows.every((r) => r.sync_status === 'synced')).toBe(true);
  });

  it('P1-2: coerces non-string `notes` to an empty session_name (no [object Object])', async () => {
    mockedGetAll.mockResolvedValueOnce({
      data: [
        {
          id: 'srv-obj',
          notes: { foo: 'bar' },
          duration_minutes: 30,
          exercises: [
            { exercise_name: 'X', reps_per_set: [1], weight_per_set: [1] },
          ],
        },
        {
          id: 'srv-null',
          notes: null,
          duration_minutes: 30,
          exercises: [
            { exercise_name: 'Y', reps_per_set: [1], weight_per_set: [1] },
          ],
        },
        {
          id: 'srv-bool',
          notes: false,
          duration_minutes: 30,
          exercises: [
            { exercise_name: 'Z', reps_per_set: [1], weight_per_set: [1] },
          ],
        },
      ],
    } as never);

    await pullFromServer(20);

    const rows = mockDbHolder.current?.rows ?? [];
    expect(rows).toHaveLength(3);
    // The old `String(w.notes ?? '')` would have produced "[object Object]",
    // "" (preserved by ??), and "false" respectively. The fix should give
    // "" for everything that isn't a string.
    expect(rows.every((r) => r.session_name === '')).toBe(true);
  });
});
