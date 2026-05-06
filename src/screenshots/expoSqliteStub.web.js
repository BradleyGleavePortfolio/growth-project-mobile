/**
 * Screenshot-mode-only stub for expo-sqlite on web.
 *
 * The real expo-sqlite web build pulls in a WASM artefact via a Metro resolver
 * path that flakes when the dev server rebuilds (UnableToResolveError on
 * ./wa-sqlite/wa-sqlite.wasm). In screenshot mode we never call initDatabase()
 * (App.tsx gates that), and none of the marketing-target screens (Home, Log,
 * Plan, Recipes, Progress, Fast) read from SQLite — they go through the axios
 * mock adapter — so we can safely substitute a no-op here.
 *
 * This file is referenced by metro.config.js via resolver.resolveRequest only
 * when EXPO_PUBLIC_SCREENSHOT_MODE=1 AND platform === 'web'.
 *
 * Use plain `exports.X =` (not `module.exports = {...}`) so Metro's interop
 * helper can still add `__esModule` and re-exports without "Cannot set
 * property default of #<Object>" errors.
 */

const noopDb = {
  execAsync: async () => {},
  runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
  getFirstAsync: async () => null,
  getAllAsync: async () => [],
  closeAsync: async () => {},
  withTransactionAsync: async (fn) => { await fn(); },
  prepareAsync: async () => ({ executeAsync: async () => ({ getAllAsync: async () => [] }), finalizeAsync: async () => {} }),
};

exports.openDatabaseAsync = async () => noopDb;
exports.openDatabaseSync = () => noopDb;
exports.deleteDatabaseAsync = async () => {};
exports.SQLiteDatabase = function SQLiteDatabase() { return noopDb; };
exports.useSQLiteContext = () => noopDb;
exports.SQLiteProvider = ({ children }) => children;
