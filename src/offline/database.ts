/**
 * Offline database singleton for The Growth Project.
 *
 * Built on expo-sqlite (the same engine used by the rest of the app under
 * src/db/*.ts) so we have a single, coherent storage stack with no native
 * architecture conflicts. Replaces the previous WatermelonDB foundation —
 * see the migration note in docs/offline-architecture.md.
 *
 * Design notes:
 *   - Lazy singleton: callers use `getDatabase()` instead of importing a
 *     module-level handle, so Jest can reset state between tests via
 *     `__resetDatabaseForTests()`.
 *   - Schema bootstrap is idempotent (CREATE TABLE IF NOT EXISTS, plus
 *     defensive ALTER TABLE additions for v2/v3 columns).
 *   - In test/web environments we open `:memory:` so suites are fully
 *     isolated and there is no on-disk state to clean up.
 *   - WAL is enabled on native for concurrent read/write performance.
 *
 * Schema versions:
 *   v1: initial workout_logs table (id, exercise_id, sets_data, sync_status,
 *       logged_at, server_id, session_name, duration_minutes).
 *   v2: add user_id TEXT to workout_logs (R15: row-level user scoping so a
 *       shared device cannot leak User A's pending pushes onto User B's JWT).
 *   v3: add status TEXT (pending|dead_letter|synced) so permanent 4xx push
 *       failures stop hammering the server forever (Hunt P1-1).
 *
 * @see docs/offline-architecture.md
 */
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

const DB_NAME = 'tgp_offline.db';

let _database: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function tableHasColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  return rows.some((r) => r.name === column);
}

/**
 * Run the idempotent schema bootstrap. Adding columns to an existing table
 * is done via ALTER TABLE guarded by a PRAGMA table_info check so reruns on
 * an already-migrated DB are no-ops.
 */
async function bootstrap(db: SQLite.SQLiteDatabase): Promise<void> {
  // WAL mode — concurrent readers don't block the writer. No-op on web.
  if (Platform.OS !== 'web') {
    await db.execAsync('PRAGMA journal_mode = WAL;');
  }

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS workout_logs (
      id TEXT PRIMARY KEY NOT NULL,
      exercise_id TEXT NOT NULL,
      sets_data TEXT NOT NULL,
      sync_status TEXT NOT NULL CHECK(sync_status IN ('pending','synced','conflict','dead_letter')),
      logged_at INTEGER NOT NULL,
      server_id TEXT,
      session_name TEXT,
      duration_minutes INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_workout_logs_sync_status ON workout_logs(sync_status);
    CREATE INDEX IF NOT EXISTS idx_workout_logs_server_id ON workout_logs(server_id);
  `);

  // v2: user_id column. Backfill against the currently-cached user so existing
  // rows aren't orphaned. New rows must always pass user_id explicitly.
  if (!(await tableHasColumn(db, 'workout_logs', 'user_id'))) {
    await db.execAsync(
      `ALTER TABLE workout_logs ADD COLUMN user_id TEXT;`,
    );
    // Backfill from readUserCacheSync at the time the migration runs.
    // Loaded via a dynamic import so the static graph doesn't pull userCache
    // (which pulls MMKV) into the bootstrap path.
    try {
      const { readUserCacheSync } = await import('../lib/userCache');
      const currentUserId: string | undefined = readUserCacheSync()?.id;
      if (currentUserId) {
        await db.runAsync(
          `UPDATE workout_logs SET user_id = ? WHERE user_id IS NULL`,
          [currentUserId],
        );
      }
    } catch {
      // No cached user (cold start before login) — leave existing rows with
      // NULL user_id; pushPending will refuse to send them until reassigned.
    }
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_workout_logs_user_id ON workout_logs(user_id);`,
    );
  }

  // v3: status column for dead-letter tracking. sync_status already exists for
  // the original tri-state machine (pending|synced|conflict); we extend that
  // column to add 'dead_letter' rather than adding a parallel column — the
  // CHECK constraint above already permits the new value. No-op on a fresh
  // bootstrap; we mention it here for migration completeness.
}

async function openAndBootstrap(): Promise<SQLite.SQLiteDatabase> {
  // In Jest / web we use an in-memory DB so there's no on-disk leakage
  // between runs and Jest workers don't fight over the same file handle.
  const inMemory =
    Platform.OS === 'web' || process.env.NODE_ENV === 'test';

  const db = await SQLite.openDatabaseAsync(
    inMemory ? ':memory:' : DB_NAME,
  );
  await bootstrap(db);
  return db;
}

/**
 * Returns (creating if necessary) the singleton offline SQLite database.
 *
 * Callers must `await` the result. The first call opens the database and
 * runs the schema bootstrap; subsequent calls return the cached handle.
 *
 * The promise is itself cached so concurrent first calls do not race to
 * open two databases.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_database) return _database;
  if (!_initPromise) {
    _initPromise = openAndBootstrap().then((db) => {
      _database = db;
      return db;
    });
  }
  return _initPromise;
}

/**
 * Reset the singleton — intended for Jest tests only.
 * Closes the cached handle so the next `getDatabase()` reopens a fresh
 * `:memory:` database with a clean schema.
 *
 * @internal
 */
export async function __resetDatabaseForTests(): Promise<void> {
  if (_database) {
    try {
      await _database.closeAsync();
    } catch {
      // Closing a :memory: handle that's already gone — non-fatal.
    }
  }
  _database = null;
  _initPromise = null;
}
