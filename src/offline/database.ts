/**
 * WatermelonDB database singleton for The Growth Project.
 *
 * Adapter selection:
 *   - Native (iOS / Android): SQLiteAdapter from @nozbe/watermelondb/adapters/sqlite.
 *     Uses WatermelonDB's bundled native sqlite module which is autolinked by
 *     React Native ≥ 0.60 / Expo prebuild. JSI is enabled for synchronous,
 *     zero-bridge reads on hot paths.
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
    // SQLiteAdapter: WatermelonDB's bundled native sqlite implementation.
    // Autolinked via React Native ≥ 0.60 / Expo config plugin during prebuild.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SQLiteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default;
    adapter = new SQLiteAdapter({
      schema,
      dbName: 'tgp_offline',
      jsi: true,
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
