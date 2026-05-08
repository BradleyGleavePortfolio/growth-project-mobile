/**
 * WatermelonDB database singleton for The Growth Project.
 *
 * Adapter selection:
 *   - Native (iOS / Android): ExpoSQLiteAdapter — wraps expo-sqlite which is
 *     already installed and listed in app.json plugins. This avoids the
 *     binary sqlite3 build step that the raw @nozbe/watermelondb SQLiteAdapter
 *     would need via a custom native module.
 *   - Web / Jest: LokiJSAdapter — in-memory, no native deps, suitable for
 *     test environments and Expo Go during development.
 *
 * @see docs/offline-architecture.md
 */
import { Database } from '@nozbe/watermelondb';
import { Platform } from 'react-native';
import { schema } from './schema';
import WorkoutLog from './models/WorkoutLog';

// Lazily-initialised singleton — call getDatabase() instead of importing
// `database` directly so tests can reset state without re-importing.
let _database: Database | null = null;

function createDatabase(): Database {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapter: any;

  if (Platform.OS === 'web' || process.env.NODE_ENV === 'test') {
    // LokiJS adapter: zero native dependencies, works in Jest and Expo web.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: LokiJSAdapter } = require('@nozbe/watermelondb/adapters/lokijs');
    adapter = new LokiJSAdapter({
      schema,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
  } else {
    // ExpoSQLiteAdapter: uses the expo-sqlite package already in the project.
    // Requires no additional native module installation for Expo SDK 51+.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ExpoSQLiteAdapter } = require('@nozbe/watermelondb/adapters/expo-sqlite');
    adapter = new ExpoSQLiteAdapter({
      schema,
      dbName: 'tgp_offline',
      // migrations: [] — add when schema version > 1
    });
  }

  return new Database({
    adapter,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelClasses: [WorkoutLog as any],
  });
}

/** Returns (creating if necessary) the singleton Database instance. */
export function getDatabase(): Database {
  if (!_database) {
    _database = createDatabase();
  }
  return _database;
}

/**
 * Reset the singleton — intended for Jest tests only.
 * @internal
 */
export function __resetDatabaseForTests(): void {
  _database = null;
}
