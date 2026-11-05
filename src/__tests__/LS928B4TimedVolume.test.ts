import {
  completedExercisePayload,
  workoutSummary,
} from '../screens/client/active-workout/sessionQuality';
import type { SessionExercise } from '../screens/client/active-workout/types';

function exercise(unit: 'reps' | 'seconds', count: number): SessionExercise {
  return {
    exerciseId: 'weighted-hold',
    exerciseName: 'Weighted hold',
    muscleGroup: 'full_body',
    unit,
    sets: [{ weight: 20, reps: count, completed: true }],
  };
}

test('ordinary completed rep sets still contribute weight times reps to lb volume', () => {
  expect(workoutSummary([exercise('reps', 10)], []).volume).toBe(200);
});

test('a known seconds set is not counted as repetitions in the finish lb-volume summary', () => {
  const timed = exercise('seconds', 60);
  // The wire arrays are deliberately unchanged by this label/summary work.
  expect(completedExercisePayload(timed).weight_per_set).toEqual([20]);
  expect(completedExercisePayload(timed).reps_per_set).toEqual([60]);
  expect(workoutSummary([timed, exercise('reps', 10)], []).volume).toBe(200);
});
