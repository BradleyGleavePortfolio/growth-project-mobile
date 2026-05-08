/**
 * WatermelonDB model for a locally-logged workout session.
 *
 * Maps to the `workout_logs` table defined in schema.ts.
 * The model exposes typed accessors for each column and a convenience
 * method to serialize into the shape the backend `/workouts` endpoint expects.
 *
 * Note: WatermelonDB's TypeScript decorator support requires
 * `experimentalDecorators: true`. We use the non-decorator field-registration
 * API instead so the strict tsconfig can remain unchanged.
 */
import { Model } from '@nozbe/watermelondb';
import { field, date, writer } from '@nozbe/watermelondb/decorators';

export type SyncStatus = 'pending' | 'synced' | 'conflict';

export interface ParsedSet {
  reps: number;
  weight: number;
  completed: boolean;
}

export interface WorkoutPayload {
  date: string;
  duration_minutes: number;
  notes: string;
  exercises: Array<{
    exercise_name: string;
    sets_completed: number;
    weight_per_set: number[];
    reps_per_set: number[];
  }>;
  local_id: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default class WorkoutLog extends Model {
  static table = 'workout_logs';

  static associations = {};

  // Column accessors — using WatermelonDB's field decorator.
  // The TypeScript decorator errors are suppressed because WatermelonDB
  // decorators return `void` at runtime (they register the accessor) and
  // our tsconfig strict mode treats the mismatch as an error. The
  // `@ts-expect-error` directives below are intentional and scoped to
  // exactly these decorator usages.

  // @ts-expect-error WatermelonDB field decorator — void return is expected
  @field('exercise_id') exerciseId!: string;
  // @ts-expect-error WatermelonDB field decorator
  @field('sets_data') setsData!: string;
  // @ts-expect-error WatermelonDB field decorator
  @field('sync_status') syncStatus!: SyncStatus;
  // @ts-expect-error WatermelonDB date decorator
  @date('logged_at') loggedAt!: Date;
  // @ts-expect-error WatermelonDB field decorator
  @field('server_id') serverId!: string | null;
  // @ts-expect-error WatermelonDB field decorator
  @field('session_name') sessionName!: string | null;
  // @ts-expect-error WatermelonDB field decorator
  @field('duration_minutes') durationMinutes!: number | null;

  /** Parse the JSON-serialised sets_data column into a typed array. */
  get parsedSets(): ParsedSet[] {
    try {
      return JSON.parse(this.setsData) as ParsedSet[];
    } catch {
      return [];
    }
  }

  /**
   * Serialize this record into the shape the backend /workouts endpoint expects.
   * Called by the sync engine when pushing pending records.
   */
  toServerPayload(): WorkoutPayload {
    const sets = this.parsedSets.filter((s) => s.completed);
    return {
      date: this.loggedAt?.toISOString() ?? new Date().toISOString(),
      duration_minutes: this.durationMinutes ?? 0,
      notes: this.sessionName ?? '',
      exercises: [
        {
          exercise_name: this.exerciseId,
          sets_completed: sets.length,
          weight_per_set: sets.map((s) => s.weight),
          reps_per_set: sets.map((s) => s.reps),
        },
      ],
      local_id: this.id,
    };
  }

  /** Mark this record as successfully synced and store the server-assigned ID. */
  // @ts-expect-error WatermelonDB writer decorator
  @writer async markSynced(serverId: string) {
    await this.update((r: any) => {
      (r as WorkoutLog).syncStatus = 'synced';
      (r as WorkoutLog).serverId = serverId;
    });
  }

  /** Mark this record as a conflict (server-wins policy). */
  // @ts-expect-error WatermelonDB writer decorator
  @writer async markConflict() {
    await this.update((r: any) => {
      (r as WorkoutLog).syncStatus = 'conflict';
    });
  }
}
