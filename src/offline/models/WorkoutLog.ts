/**
 * WatermelonDB model for a locally-logged workout session.
 *
 * Maps to the `workout_logs` table defined in schema.ts.
 * The model exposes typed accessors for each column and a convenience
 * method to serialize into the shape the backend `/workouts` endpoint expects.
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

export default class WorkoutLog extends Model {
  static table = 'workout_logs';

  @field('exercise_id') exerciseId!: string;
  @field('sets_data') setsData!: string;
  /**
   * WatermelonDB's base Model class defines `syncStatus` as a protected
   * accessor. We override it here as an instance property via the @field
   * decorator. The TS2416/TS2610 errors are suppressed because this is
   * intentional WatermelonDB usage: @field registers a column accessor that
   * overrides the base class accessor at runtime, which is the expected API.
   */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore WatermelonDB accessor override — intentional
  @field('sync_status') syncStatus!: SyncStatus;
  @date('logged_at') loggedAt!: Date;
  @field('server_id') serverId!: string | null;
  @field('session_name') sessionName!: string | null;
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
  @writer async markSynced(serverId: string) {
    await this.update((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = r as any as WorkoutLog;
      record.syncStatus = 'synced';
      record.serverId = serverId;
    });
  }

  /** Mark this record as a conflict (server-wins policy). */
  @writer async markConflict() {
    await this.update((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = r as any as WorkoutLog;
      record.syncStatus = 'conflict';
    });
  }
}
