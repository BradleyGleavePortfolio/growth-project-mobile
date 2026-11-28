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
export type {
  SyncStatus,
  ParsedSet,
  WorkoutPayload,
  WorkoutLog,
} from './models/WorkoutLog';
export {
  rowToWorkoutLog,
  parsedSets,
  toServerPayload,
} from './models/WorkoutLog';
export { default as WorkoutLogDefault } from './models/WorkoutLog';
export {
  writeWorkoutLog,
  triggerSync,
  pullFromServer,
  conflictToastEvents,
  markSessionSyncedBySessionName,
  queueWorkout,
  settleQueuedWorkout,
  releaseQueuedWorkout,
  countQueuedWorkouts,
  pushQueuedWorkouts,
  workoutSyncEvents,
  __isSyncInProgress,
} from './sync/sync-engine';
// WORKOUT-REFUSAL-DAY-M: what the refused-workout card (RefusedWorkoutCard) takes.
export {
  deadLetterEvents,
  listRefusedWorkouts,
  sendRefusedWorkoutAgain,
  removeRefusedWorkout,
} from './sync/sync-engine';
export { canSendAgain, refusalLines } from './sync/refusal';
export type {
  WriteWorkoutPayload,
  QueueWorkoutInput,
  QueueWorkoutResult,
  QueuedAssignmentCompletion,
  RefusedWorkout,
} from './sync/sync-engine';
