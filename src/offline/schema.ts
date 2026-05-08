/**
 * WatermelonDB schema definition for The Growth Project offline data.
 *
 * Tables defined here:
 *   - workout_logs: local-first workout session records with sync tracking.
 *
 * Other tables to add in follow-up PRs:
 *   - food_logs (currently queue-based via foodLogQueue.ts — migrate to WDB)
 *   - habits (HabitsScreen)
 *   - body_weight (ProgressScreen)
 *
 * @see docs/offline-architecture.md for design rationale.
 */
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'workout_logs',
      columns: [
        /** Client-generated UUID written at creation time. */
        { name: 'exercise_id', type: 'string' },
        /**
         * JSON-serialised array of completed sets.
         * Shape: Array<{ reps: number; weight: number; completed: boolean }>
         */
        { name: 'sets_data', type: 'string' },
        /**
         * Offline sync state machine:
         *   pending   — written locally, not yet pushed to server
         *   synced    — server acknowledged; server_id is populated
         *   conflict  — server returned a conflict; server copy preserved,
         *               local surfaced as a non-blocking toast
         */
        { name: 'sync_status', type: 'string', isIndexed: true },
        /** ISO-8601 timestamp of when the set was logged on-device. */
        { name: 'logged_at', type: 'number' },
        /** Server-assigned workout ID — null until sync completes. */
        { name: 'server_id', type: 'string', isOptional: true },
        /** Human-readable session name / routine name. */
        { name: 'session_name', type: 'string', isOptional: true },
        /** Duration of the session in minutes (captured at finish time). */
        { name: 'duration_minutes', type: 'number', isOptional: true },
      ],
    }),
  ],
});
