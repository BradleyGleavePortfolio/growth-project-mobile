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
 *   - Schema bootstrap is idempotent (CREATE TABLE IF NOT EXISTS).
 *   - In test/web environments we open `:memory:` so suites are fully
 *     isolated and there is no on-disk state to clean up.
 *   - WAL is enabled on native for concurrent read/write performance.
 *
 * @see docs/offline-architecture.md
 */
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

const DB_NAME = 'tgp_offline.db';

let _database: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Run the idempotent schema bootstrap. Adding columns to an existing table
 * should be done via ALTER TABLE in a follow-up migration step keyed off
 * a `schema_version` row in a meta table — for now, the schema is v1.
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
      sync_status TEXT NOT NULL CHECK(sync_status IN ('pending','synced','conflict')),
      logged_at INTEGER NOT NULL,
      server_id TEXT,
      session_name TEXT,
      duration_minutes INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_workout_logs_sync_status ON workout_logs(sync_status);
    CREATE INDEX IF NOT EXISTS idx_workout_logs_server_id ON workout_logs(server_id);
  `);
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
