/**
 * FIX-974R1 (LO-974R1 C4, LS-974R1 C1): the same exercise twice in one workout (main's add-exercise allows it). The
 * record (main's workoutSummary, by name) is one line, from a block that lifted that weight; a block with no ticked
 * set at the record weight never draws "× -Infinity".
 */
import { whatMoved } from '../summaryC5';
import type { SessionExercise } from '../types';

const set = (weight: number, reps: number, completed = true) => ({ weight, reps, completed });
const block = (id: string, sets: SessionExercise['sets']): SessionExercise => ({
  exerciseId: id, exerciseName: 'Back squat', muscleGroup: 'legs', restSec: 60, sets,
});
const records = [{ name: 'Back squat', weight: 185 }];

it.each([
  ['the record block first', [block('a', [set(185, 5), set(185, 4)]), block('b', [set(135, 8), set(135, 8)])]],
  ['the record block second', [block('a', [set(135, 8), set(135, 8)]), block('b', [set(185, 5), set(185, 4)])]],
  ['both blocks at the record weight', [block('a', [set(185, 5)]), block('b', [set(185, 3)])]],
])('%s: one record line, a real rep count', (_case, exercises) => {
  const lines = whatMoved(exercises, [], records, {});
  expect(lines.filter((l) => l.kind === 'best')).toHaveLength(1);
  for (const l of lines) expect(l.text).not.toMatch(/Infinity|NaN/);
  expect(lines[0].text).toBe('Back squat: 185 × 5, heaviest in your last 50 saved workouts');
});

it('the record weight only on an unticked set: no record line', () => {
  const lines = whatMoved([block('a', [set(135, 8), set(185, 5, false)])], [], records, {});
  expect(lines).toEqual([]);
});
