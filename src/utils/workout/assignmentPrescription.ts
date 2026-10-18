/**
 * K3FIX-SNAPSHOT: the one rule for what a client assignment shows and starts.
 *
 * Since MWB-1 the server freezes the plan when it is assigned. The reads return
 * the frozen rows as top-level `exercises` (`snapshot_source: true`) and the
 * frozen name and type on `snapshot`, so the coach's later edits to the live
 * `workout_plan` never change an assignment. Only a reply without the
 * `exercises` field (a server before MWB-1) falls back to the live rows; an
 * empty frozen list stays empty.
 *
 * Coach-approved Roman set changes are laid over the rows by `order`. The
 * server also writes them into the snapshot, so on the frozen path the overlay
 * only marks them.
 */
import type {
  AssignmentExercise,
  ClientWorkoutAssignmentWithPlan,
  WorkoutType,
} from '../../api/workoutBuilderApi';
import { overlayRomanAdjustedSets } from './romanAdjustedSets';

export interface AssignmentPrescription {
  name: string;
  type: WorkoutType | undefined;
  /** The live plan's estimate: a snapshot saves no duration. */
  durationMinutes: number | null;
  /** Sorted by `order`, coach-approved Roman sets applied. */
  exercises: AssignmentExercise[];
  /** Orders whose set count comes from a coach-approved Roman change. */
  adjustedOrders: ReadonlySet<number>;
}

type Named = {
  snapshot?: { plan_name?: string } | null;
  workout_plan?: { name?: string } | null;
};

/** The assignment's name as the client sees it: the frozen name when saved. */
export function assignmentPlanName(a: Named): string | undefined {
  return a.snapshot?.plan_name || a.workout_plan?.name;
}

export function assignmentPrescription(
  a: ClientWorkoutAssignmentWithPlan,
): AssignmentPrescription {
  const canonical = a.exercises !== undefined || a.snapshot_source === true;
  const rows = canonical ? a.exercises ?? [] : a.workout_plan?.exercises ?? [];
  const { exercises, adjustedOrders } = overlayRomanAdjustedSets(
    [...rows].sort((x, y) => x.order - y.order),
    a.roman_adjusted_sets,
  );
  return {
    name: assignmentPlanName(a) ?? '',
    type: a.snapshot?.plan_type ?? a.workout_plan?.type,
    durationMinutes: a.workout_plan?.duration_estimate_minutes ?? null,
    exercises,
    adjustedOrders,
  };
}
