/**
 * TRAIN-GATE-128 (owner 15:03 10-07): while a live workout is open, a tab
 * press to another tab asks first whether to log the workout. The live
 * workout screen registers the question here; the client tab navigator asks
 * it before switching. `leave` performs the original tab switch.
 */
export type WorkoutLeaveGuard = (leave: () => void) => void;

let current: WorkoutLeaveGuard | null = null;

/** Registers the guard; returns the unregister function. */
export function setWorkoutLeaveGuard(guard: WorkoutLeaveGuard): () => void {
  current = guard;
  return () => {
    if (current === guard) current = null;
  };
}

export function workoutLeaveGuard(): WorkoutLeaveGuard | null {
  return current;
}
