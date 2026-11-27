/**
 * PR-ALERTS-M (C1 v2 C2_logger, LO-WORKOUT C7): which block of the live workout carries the recent-best star line, and
 * its words. No screen code. One rule with What moved: the record is main's (workoutSummary's records over the last 50
 * saved workouts the screen read), picked and filtered with What moved's own pieces (never a seconds or body-weight
 * exercise; the heaviest of a name's records). One line per exercise: on the block holding a ticked set at that weight,
 * the one ticked first (doneOrder; without it, the earlier block). It reads nothing else: no history, clock or storage.
 */
import { SUMMARY_COPY, carriesLb, nameKey, nameRecord } from './summaryC5';
import type { SessionExercise, SessionSet } from './types';

export interface BlockBest {
  /** The exercise's name key and the record weight; the screen adds the workout's start for the star's one fade. */
  key: string;
  weight: number;
  /** PA-W1, as C2_logger draws it. */
  text: string;
  /** PA-W2: the line spoken, "Recent best" (WSM-03) first. */
  spoken: string;
}

const BASIS = 'heaviest in your last 50 saved workouts'; // WSM-02's basis words
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Each block's line, or null. `records` is workoutSummary(...).records over the same sets and history. */
export function blockBests(
  exercises: ReadonlyArray<SessionExercise>,
  records: ReadonlyArray<{ name: string; weight: number }>,
  bodyWeight: Record<string, boolean | undefined>,
): Array<BlockBest | null> {
  const out: Array<BlockBest | null> = exercises.map(() => null);
  // A set holds the record only when it was lifted for reps (main's rule counts no set with 0 reps).
  const atRecord = (exercise: SessionExercise, weight: number): SessionSet[] =>
    exercise.sets.filter((set) => set.completed && set.reps > 0 && set.weight === weight);
  const keys = new Set(exercises.map((e) => nameKey(e.exerciseName)));
  for (const key of keys) {
    const record = nameRecord(records, key);
    if (!record) continue;
    let at = -1;
    let first = Infinity;
    exercises.forEach((exercise, i) => {
      if (nameKey(exercise.exerciseName) !== key) return;
      const sets = atRecord(exercise, record.weight);
      if (sets.length === 0) return;
      const order = Math.min(...sets.map((set) => set.doneOrder ?? Infinity));
      if (at < 0 || order < first) { at = i; first = order; }
    });
    if (at < 0) continue;
    const sets = atRecord(exercises[at], record.weight);
    const reps = Math.max(...sets.map((set) => set.reps));
    const k = sets.filter((set) => set.reps === reps).length;
    const w = record.weight.toLocaleString();
    out[at] = {
      key: `${key}@${record.weight}`,
      weight: record.weight,
      text: `${k} × ${reps} at ${w} lb, ${BASIS}`,
      spoken: `${SUMMARY_COPY.recentBest}: ${count(k, 'set', 'sets')} of ${count(reps, 'rep', 'reps')} at ${w} pounds, ${BASIS}`,
    };
  }
  return out;
}
