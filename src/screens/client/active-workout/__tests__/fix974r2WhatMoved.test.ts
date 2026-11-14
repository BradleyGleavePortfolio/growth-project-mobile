/**
 * FIX-974R2 (LS-974R2 C1, operator ruling): one exercise in two blocks where each block beats the old best. Main's
 * workoutSummary gives one record per block (185, then 225); What moved draws one line, with the true best (the
 * heaviest of that name's records) and the most reps any ticked set of that name lifted at that weight, whichever
 * block it was in. The records come from the real workoutSummary over the same sets.
 */
import { workoutSummary, type LoggedWorkout } from '../sessionQuality';
import { whatMoved } from '../summaryC5';
import type { SessionExercise } from '../types';

const set = (weight: number, reps: number, completed = true) => ({ weight, reps, completed });
const block = (id: string, sets: SessionExercise['sets'], name = 'Back squat'): SessionExercise => ({
  exerciseId: id, exerciseName: name, muscleGroup: 'legs', restSec: 60, sets,
});
const history: LoggedWorkout[] = [{
  id: 'h1', workout_name: 'Legs', notes: '', duration_minutes: 50,
  exercises: [{ exercise_name: 'Back squat', muscle_group: 'legs', sets_completed: 2, weight_per_set: [175, 175], reps_per_set: [5, 5] }],
} as unknown as LoggedWorkout];

it.each([
  ['185 then 225 (the audit case)', [block('a', [set(185, 5)]), block('b', [set(225, 3)])], 'Back squat: 225 × 3, heaviest in your last 50 saved workouts'],
  ['225 then 185', [block('a', [set(225, 3)]), block('b', [set(185, 5)])], 'Back squat: 225 × 3, heaviest in your last 50 saved workouts'],
  ['225 in both blocks: the most reps at it', [block('a', [set(225, 2)]), block('b', [set(225, 4), set(185, 6)])], 'Back squat: 225 × 4, heaviest in your last 50 saved workouts'],
  ['the name in another case and spacing', [block('a', [set(185, 5)]), block('b', [set(225, 3)], ' back SQUAT ')], 'Back squat: 225 × 3, heaviest in your last 50 saved workouts'],
  ['225 only on an unticked set: the ticked best', [block('a', [set(185, 5)]), block('b', [set(225, 3, false), set(195, 4)])], 'Back squat: 195 × 4, heaviest in your last 50 saved workouts'],
])('%s: one record line, the heaviest', (_case, exercises, text) => {
  const { records } = workoutSummary(exercises, history);
  expect(records.length).toBeGreaterThan(0);
  const lines = whatMoved(exercises, history, records, {});
  const best = lines.filter((l) => l.kind === 'best');
  expect(best).toHaveLength(1);
  expect(best[0].text).toBe(text);
  expect(best[0].weight).toBe(Math.max(...records.map((r) => r.weight)));
  for (const l of lines) expect(l.text).not.toMatch(/Infinity|NaN/);
});
