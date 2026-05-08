/**
 * Barrel export for the offline module.
 *
 * Consumers should import from here, not from sub-paths, so internal
 * restructuring doesn't break call sites.
 *
 * @example
 *   import { writeWorkoutLog, triggerSync, getDatabase } from '../offline';
 */
export { getDatabase, __resetDatabaseForTests } from './database';
export { schema } from './schema';
export type { SyncStatus, ParsedSet, WorkoutPayload } from './models/WorkoutLog';
export { default as WorkoutLog } from './models/WorkoutLog';
export {
  writeWorkoutLog,
  triggerSync,
  pullFromServer,
  conflictToastEvents,
  __isSyncInProgress,
} from './sync/sync-engine';
export type { WriteWorkoutPayload } from './sync/sync-engine';
